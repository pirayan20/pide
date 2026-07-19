use std::io::{Read, Write};
use std::net::TcpListener;
use std::time::{Duration, Instant};

pub fn parse_callback(request_line: &str) -> Option<(String, String)> {
    let path = request_line.split_whitespace().nth(1)?;
    let query = path.split_once('?')?.1;
    let mut code = None;
    let mut state = None;
    for pair in query.split('&') {
        match pair.split_once('=') {
            Some(("code", v)) => code = Some(v.to_string()),
            Some(("state", v)) => state = Some(v.to_string()),
            _ => {}
        }
    }
    Some((code?, state?))
}

/// Bind the loopback listener up front so port-busy is detected before the
/// browser is opened. Non-blocking, ready for `wait_on`.
pub fn bind(port: u16) -> Option<TcpListener> {
    let listener = TcpListener::bind(("127.0.0.1", port)).ok()?;
    listener.set_nonblocking(true).ok()?;
    Some(listener)
}

/// Accept callback requests on an already-bound listener, verify state,
/// return the code. Blocks up to `timeout`. Tolerates individual connection
/// errors (e.g. Chrome's speculative loopback preconnects) instead of
/// aborting the whole wait.
pub fn wait_on(listener: &TcpListener, expected_state: &str, timeout: Duration) -> Option<String> {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        match listener.accept() {
            Ok((mut stream, _)) => {
                // On macOS/BSD the accepted socket inherits the listener's
                // non-blocking flag; make the read block so we don't drop a
                // legit callback whose bytes haven't arrived in this instant.
                let _ = stream.set_nonblocking(false);
                let mut buf = [0u8; 2048];
                let n = match stream.read(&mut buf) {
                    Ok(n) => n,
                    Err(_) => continue,
                };
                let text = String::from_utf8_lossy(&buf[..n]);
                let first = text.lines().next().unwrap_or("");
                let result = parse_callback(first).filter(|(_, s)| s == expected_state);
                let body = if result.is_some() {
                    "Login complete. You can close this tab and return to Pide."
                } else {
                    "Login failed (state mismatch). You can close this tab."
                };
                let _ = write!(
                    stream,
                    "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{}",
                    body.len(),
                    body
                );
                if let Some((code, _)) = result {
                    return Some(code);
                }
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(_) => {
                std::thread::sleep(Duration::from_millis(100));
                continue;
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_code_and_state_from_request_line() {
        let line = "GET /auth/callback?code=abc123&state=xyz HTTP/1.1";
        let (code, state) = parse_callback(line).unwrap();
        assert_eq!(code, "abc123");
        assert_eq!(state, "xyz");
    }

    #[test]
    fn none_without_code() {
        assert!(parse_callback("GET /auth/callback?state=xyz HTTP/1.1").is_none());
    }
}
