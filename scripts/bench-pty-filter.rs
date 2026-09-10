#[path = "../src-tauri/src/modules/pty/da_filter.rs"]
mod da_filter;
use std::{hint::black_box, time::Instant};
fn main() {
    let mut filter = da_filter::DaFilter::new();
    let mut out = Vec::with_capacity(16384);
    filter.process(b"shell prompt\r\n", &mut out, |_| {
        panic!("unexpected reply")
    });
    let chunk = b"\x1b[2K\x1b[32mWorking on terminal output 1234567890\x1b[0m\r\n".repeat(256);
    let mut times = Vec::new();
    for _ in 0..7 {
        let start = Instant::now();
        for _ in 0..5000 {
            out.clear();
            filter.process(black_box(&chunk), &mut out, |_| panic!("unexpected reply"));
            assert_eq!(out.as_slice(), chunk.as_slice());
            black_box(&out);
        }
        times.push(start.elapsed().as_secs_f64() * 1000.0);
    }
    times.sort_by(f64::total_cmp);
    println!(
        "ANSI post-startup: {} bytes/replay, median {:.3} ms; all bytes preserved",
        chunk.len() * 5000,
        times[3]
    );
}
