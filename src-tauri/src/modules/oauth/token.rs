use super::store::Tokens;
use super::ProviderConfig;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde_json::{json, Value};
use std::time::Duration;

pub fn email_from_id_token(id_token: &str) -> Option<String> {
    let payload_b64 = id_token.split('.').nth(1)?;
    let bytes = URL_SAFE_NO_PAD.decode(payload_b64).ok()?;
    let claims: Value = serde_json::from_slice(&bytes).ok()?;
    claims.get("email").and_then(Value::as_str).map(str::to_string)
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn client(cfg: &ProviderConfig) -> Option<reqwest::blocking::Client> {
    let mut b = reqwest::blocking::Client::builder().timeout(Duration::from_secs(15));
    if let Some(ua) = cfg.user_agent {
        b = b.user_agent(ua);
    }
    b.build().ok()
}

fn tokens_from_response(body: &Value, prior_refresh: Option<&str>) -> Option<Tokens> {
    let access = body.get("access_token")?.as_str()?.to_string();
    // some refreshes omit a new refresh_token; keep the prior one then
    let refresh = body
        .get("refresh_token")
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| prior_refresh.map(str::to_string))?;
    let expires_in = body.get("expires_in").and_then(Value::as_i64).unwrap_or(3600);
    let account = body.get("id_token").and_then(Value::as_str).and_then(email_from_id_token);
    Some(Tokens { access, refresh, expires_at: now_ms() + expires_in * 1000, account })
}

pub fn exchange_code(cfg: &ProviderConfig, code: &str, verifier: &str, state: Option<&str>) -> Option<Tokens> {
    let c = client(cfg)?;
    let mut body = json!({
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": cfg.redirect_uri,
        "client_id": cfg.client_id,
        "code_verifier": verifier,
    });
    if let Some(s) = state {
        body["state"] = json!(s);
    }
    let resp = c.post(cfg.token_url).json(&body).send().ok()?;
    if !resp.status().is_success() {
        return None;
    }
    tokens_from_response(&resp.json::<Value>().ok()?, None)
}

pub fn refresh(cfg: &ProviderConfig, refresh_token: &str) -> Option<Tokens> {
    let c = client(cfg)?;
    let resp = c
        .post(cfg.token_url)
        .json(&json!({
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "client_id": cfg.client_id,
            "scope": cfg.scope,
        }))
        .send()
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    tokens_from_response(&resp.json::<Value>().ok()?, Some(refresh_token))
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};

    #[test]
    fn email_extracted_from_jwt_payload() {
        let payload = URL_SAFE_NO_PAD.encode(br#"{"email":"user@example.com","sub":"x"}"#);
        let jwt = format!("header.{payload}.sig");
        assert_eq!(email_from_id_token(&jwt).as_deref(), Some("user@example.com"));
    }

    #[test]
    fn email_none_when_malformed() {
        assert!(email_from_id_token("not-a-jwt").is_none());
    }
}
