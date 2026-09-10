use std::sync::{Condvar, Mutex};
use std::thread;
use std::time::Duration;

const FLUSH_COALESCE: Duration = Duration::from_millis(4);
const MAX_PENDING: usize = 4 * 1024 * 1024;
const OVERFLOW_NOTICE: &[u8] = b"\x1bc\x1b[2m[pide: dropped output due to backpressure]\x1b[0m\r\n";

struct Pending {
    bytes: Vec<u8>,
    closed: bool,
}

pub(crate) struct OutputQueue {
    pending: Mutex<Pending>,
    ready: Condvar,
    #[cfg(test)]
    idle_wakes: std::sync::atomic::AtomicUsize,
}

impl OutputQueue {
    pub(crate) fn new() -> Self {
        Self {
            pending: Mutex::new(Pending {
                bytes: Vec::with_capacity(16 * 1024),
                closed: false,
            }),
            ready: Condvar::new(),
            #[cfg(test)]
            idle_wakes: std::sync::atomic::AtomicUsize::new(0),
        }
    }

    pub(crate) fn push(&self, bytes: &[u8]) -> Option<usize> {
        let mut pending = self.pending.lock().unwrap();
        if pending.closed {
            return None;
        }
        let was_empty = pending.bytes.is_empty();
        let mut dropped = 0;
        if pending.bytes.len() + bytes.len() > MAX_PENDING {
            dropped = pending.bytes.len();
            pending.bytes.clear();
            pending.bytes.extend_from_slice(OVERFLOW_NOTICE);
        }
        pending.bytes.extend_from_slice(bytes);
        if was_empty && !pending.bytes.is_empty() {
            self.ready.notify_one();
        }
        Some(dropped)
    }

    pub(crate) fn close(&self) {
        let mut pending = self.pending.lock().unwrap();
        pending.closed = true;
        self.ready.notify_all();
    }

    pub(crate) fn flush_to(&self, mut send: impl FnMut(Vec<u8>) -> bool) {
        loop {
            let mut pending = self.pending.lock().unwrap();
            while pending.bytes.is_empty() && !pending.closed {
                pending = self.ready.wait(pending).unwrap();
                #[cfg(test)]
                if pending.bytes.is_empty() && !pending.closed {
                    self.idle_wakes
                        .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                }
            }
            if pending.bytes.is_empty() && pending.closed {
                return;
            }
            if !pending.closed {
                drop(pending);
                thread::sleep(FLUSH_COALESCE);
                pending = self.pending.lock().unwrap();
            }
            let chunk = std::mem::take(&mut pending.bytes);
            drop(pending);
            if !send(chunk) {
                self.close();
                return;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{atomic::Ordering, mpsc, Arc};

    #[test]
    fn idle_queue_does_not_poll_and_close_wakes_it() {
        let queue = Arc::new(OutputQueue::new());
        let worker_queue = queue.clone();
        let (finished, completion) = mpsc::channel();
        let worker = thread::spawn(move || {
            worker_queue.flush_to(|_| panic!("idle queue emitted data"));
            finished.send(()).unwrap();
        });
        assert!(completion.recv_timeout(Duration::from_millis(220)).is_err());
        let wakes = queue.idle_wakes.load(Ordering::Relaxed);
        queue.close();
        completion.recv_timeout(Duration::from_secs(1)).unwrap();
        worker.join().unwrap();
        assert_eq!(wakes, 0, "idle terminal scheduled unnecessary wakeups");
    }

    #[test]
    fn close_drains_every_byte_in_order_including_an_in_flight_send() {
        let queue = Arc::new(OutputQueue::new());
        queue.push(b"first");
        let (entered, first_send) = mpsc::channel();
        let (resume, resumed) = mpsc::channel();
        let worker_queue = queue.clone();
        let worker = thread::spawn(move || {
            let mut chunks = Vec::new();
            worker_queue.flush_to(|bytes| {
                if chunks.is_empty() {
                    entered.send(()).unwrap();
                    resumed.recv_timeout(Duration::from_secs(1)).unwrap();
                }
                chunks.push(bytes);
                true
            });
            chunks.concat()
        });
        first_send.recv_timeout(Duration::from_secs(1)).unwrap();
        queue.push(b"last\x1b[0m\r\n");
        queue.close();
        assert!(queue.push(b"too late").is_none());
        resume.send(()).unwrap();
        assert_eq!(worker.join().unwrap(), b"firstlast\x1b[0m\r\n");
    }

    #[test]
    fn sparse_output_wakes_a_waiting_flusher() {
        let queue = Arc::new(OutputQueue::new());
        let worker_queue = queue.clone();
        let (output, received) = mpsc::channel();
        let worker = thread::spawn(move || {
            worker_queue.flush_to(|bytes| output.send(bytes).is_ok());
        });
        for bytes in [b"a".as_slice(), b"\x1b[31m", "ไทย".as_bytes()] {
            queue.push(bytes);
            assert_eq!(
                received.recv_timeout(Duration::from_secs(1)).unwrap(),
                bytes
            );
        }
        queue.close();
        worker.join().unwrap();
    }

    #[test]
    fn failed_delivery_stops_accepting_output() {
        let queue = OutputQueue::new();
        queue.push(b"output");
        queue.flush_to(|_| false);
        assert!(queue.push(b"more").is_none());
    }

    #[test]
    fn overflow_preserves_the_existing_reset_notice_and_newest_chunk() {
        let queue = OutputQueue::new();
        for _ in 0..256 {
            assert_eq!(queue.push(&[b'x'; 16 * 1024]), Some(0));
        }
        assert_eq!(queue.push(b"latest"), Some(MAX_PENDING));
        queue.close();
        let mut result = Vec::new();
        queue.flush_to(|bytes| {
            result.extend(bytes);
            true
        });
        assert_eq!(result, [OVERFLOW_NOTICE, b"latest"].concat());
    }

    #[test]
    fn output_and_close_before_the_flusher_starts_are_not_lost() {
        let queue = OutputQueue::new();
        queue.push(b"tail");
        queue.close();
        let mut result = Vec::new();
        queue.flush_to(|bytes| {
            result.extend(bytes);
            true
        });
        assert_eq!(result, b"tail");
    }
}
