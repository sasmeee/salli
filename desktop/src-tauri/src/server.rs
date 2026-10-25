use crate::parser::spawn_parser;
use crate::state::{PairBody, Shared, SyncBody, save};
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, State},
    http::{HeaderMap, StatusCode},
    routing::{get, post},
};
use tauri::Emitter;

async fn ping() -> &'static str {
    "salli"
}

async fn pair(
    State(s): State<Shared>,
    Json(body): Json<PairBody>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let ok = {
        let c = s.code.lock().unwrap();
        let input = body.code.replace(' ', "");
        !input.is_empty() && (input == c.current || input == c.previous)
    };
    if !ok {
        return Err(StatusCode::UNAUTHORIZED);
    }
    let token = uuid::Uuid::new_v4().simple().to_string();
    s.store.lock().unwrap().sessions.insert(token.clone());
    save(&s);
    let _ = s.app.emit("phone-paired", ());
    Ok(Json(serde_json::json!({ "token": token })))
}

async fn sync(
    State(s): State<Shared>,
    headers: HeaderMap,
    Json(body): Json<SyncBody>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let tok = headers
        .get("x-salli-token")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if !s.store.lock().unwrap().sessions.contains(tok) {
        return Err(StatusCode::UNAUTHORIZED);
    }
    let (added, total) = {
        let mut st = s.store.lock().unwrap();
        let mut added = 0;
        for m in body.messages {
            if !st.inbox.iter().any(|x| x.id == m.id) {
                st.inbox.push(m);
                added += 1;
            }
        }
        (added, st.inbox.len())
    };
    save(&s);
    let _ = s.app.emit(
        "sms-synced",
        serde_json::json!({ "added": added, "total": total }),
    );
    spawn_parser(s.clone());
    Ok(Json(
        serde_json::json!({ "ok": true, "added": added, "total": total }),
    ))
}

pub(crate) fn router(shared: Shared) -> Router {
    Router::new()
        .route("/ping", get(ping))
        .route("/pair", post(pair))
        .route("/sync", post(sync))
        .layer(DefaultBodyLimit::max(20 * 1024 * 1024))
        .with_state(shared)
}
