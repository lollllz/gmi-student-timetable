use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use timetable_core::{date, text};
use wasm_bindgen::{prelude::*, JsCast};
use wasm_bindgen_futures::JsFuture;
fn js(value: &Value) -> Result<JsValue, JsValue> {
    value
        .serialize(&serde_wasm_bindgen::Serializer::json_compatible())
        .map_err(|e| e.to_string().into())
}
async fn call(
    adapter: &JsValue,
    op: &str,
    store: &str,
    key: &str,
    data: JsValue,
    options: &Value,
) -> Result<Value, JsValue> {
    let args = js_sys::Array::new();
    for v in [
        JsValue::from_str(op),
        JsValue::from_str(store),
        JsValue::from_str(key),
        data,
        js(options)?,
    ] {
        args.push(&v);
    }
    let promise = adapter
        .dyn_ref::<js_sys::Function>()
        .ok_or("Storage adapter unavailable")?
        .apply(&JsValue::NULL, &args)?;
    let value = JsFuture::from(js_sys::Promise::resolve(&promise)).await?;
    if value.is_undefined() || value.is_null() {
        Ok(Value::Null)
    } else {
        serde_wasm_bindgen::from_value(value).map_err(|e| e.to_string().into())
    }
}
async fn get(a: &JsValue, s: &str, k: &str) -> Result<Value, JsValue> {
    call(a, "get", s, k, JsValue::NULL, &json!({})).await
}
async fn set(a: &JsValue, s: &str, k: &str, v: &Value, opts: &Value) -> Result<Value, JsValue> {
    call(a, "set", s, k, js(v)?, opts).await
}
fn reply(body: Value, status: u16, origin: &str, cache: &str) -> Value {
    let mut headers = json!({"Content-Type":"application/json","Cache-Control":"no-store","Vary":"Origin","Netlify-Vary":"header=Origin, query","X-Content-Type-Options":"nosniff"});
    if [
        "https://lollllz.github.io",
        "https://gmi-schedule.netlify.app",
    ]
    .contains(&origin)
    {
        headers["Access-Control-Allow-Origin"] = json!(origin);
        headers["Access-Control-Allow-Methods"] = json!("GET, POST, OPTIONS");
        headers["Access-Control-Allow-Headers"] = json!("Content-Type, X-Timetable-Filename");
    }
    if !cache.is_empty() {
        headers["Cache-Control"] = json!("public, max-age=30");
        headers["Netlify-CDN-Cache-Control"] = json!(cache);
    }
    json!({"body":body,"status":status,"headers":headers})
}
fn error(message: &str, status: u16, origin: &str) -> Value {
    reply(json!({"error":message}), status, origin, "")
}
fn stamp(now: f64) -> String {
    chrono::DateTime::from_timestamp_millis(now as i64)
        .unwrap()
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}
fn parse_time(s: &str) -> f64 {
    chrono::DateTime::parse_from_rfc3339(s)
        .map(|d| d.timestamp_millis() as f64)
        .unwrap_or(f64::NAN)
}
fn valid_label(s: &str) -> bool {
    let len = s.chars().count();
    len >= 1
        && len <= 60
        && s.chars()
            .all(|c| c.is_alphanumeric() || " .()/#-".contains(c))
}
#[wasm_bindgen]
pub fn max_body(path: &str) -> usize {
    if path == "/api/publish-timetable" {
        4 * 1024 * 1024
    } else {
        1024
    }
}
#[wasm_bindgen]
pub async fn handle(
    request: JsValue,
    bytes: Vec<u8>,
    adapter: JsValue,
) -> Result<JsValue, JsValue> {
    let request: Value =
        serde_wasm_bindgen::from_value(request).map_err(|e| JsValue::from_str(&e.to_string()))?;
    let origin = text(&request, "origin");
    let result=inner(&request,&bytes,&adapter).await.unwrap_or_else(|_|error("The service is temporarily unavailable. Refresh before retrying to check whether your upload completed.",503,origin));
    js(&result)
}
async fn inner(req: &Value, bytes: &[u8], a: &JsValue) -> Result<Value, JsValue> {
    let origin = text(req, "origin");
    let method = text(req, "method");
    let path = text(req, "path");
    let now = req["now"].as_f64().unwrap_or(0.);
    let production = req["production"] == true
        && (text(req, "host") == "gmi-campus-reports.netlify.app"
            || path.starts_with("/internal/"));
    let owned = [
        "https://lollllz.github.io",
        "https://gmi-schedule.netlify.app",
    ]
    .contains(&origin);
    if !origin.is_empty() && !owned {
        return Ok(error("Origin not allowed.", 403, origin));
    }
    if method == "OPTIONS" {
        return Ok(reply(Value::Null, 204, origin, ""));
    }
    if !["GET", "POST"].contains(&method) {
        return Ok(error("Method not allowed.", 405, origin));
    }
    let lift_store = if production {
        "lift-reports".into()
    } else {
        format!("lift-preview-{}", text(req, "deployId"))
    };
    let tt_store = if production {
        "community-timetables".into()
    } else {
        format!("timetable-preview-{}", text(req, "deployId"))
    };
    if path.starts_with("/internal/") {
        if !production {
            return Ok(reply(Value::Null, 204, origin, ""));
        }
        return cleanup(req, a, &lift_store, &tt_store).await;
    }
    let cache = if req["query"]["fresh"].is_null() {
        "public, durable, s-maxage=120, stale-while-revalidate=600"
    } else {
        ""
    };
    if path == "/api/lifts" {
        if method == "POST" {
            if !owned {
                return Ok(error("Submit from the timetable website.", 403, origin));
            }
            if !text(req, "contentType").starts_with("application/json") {
                return Ok(error("JSON required.", 415, origin));
            }
            if bytes.len() > 1024 {
                return Ok(error("Report too large.", 413, origin));
            }
            let input: Value = match serde_json::from_slice(bytes) {
                Ok(v) => v,
                Err(_) => return Ok(error("Invalid report.", 400, origin)),
            };
            let clean = |key| {
                text(&input, key)
                    .split_whitespace()
                    .collect::<Vec<_>>()
                    .join(" ")
            };
            let building = clean("building");
            let lift = clean("lift");
            if !valid_label(&building)
                || !valid_label(&lift)
                || !["working", "intermittent", "out-of-service"].contains(&text(&input, "status"))
                || !text(&input, "website").is_empty()
            {
                return Ok(error("Choose a condition and enter a building and lift label (up to 60 characters each).",400,origin));
            }
            let report = json!({"id":text(req,"uuid"),"building":building,"lift":lift,"status":text(&input,"status"),"observedAt":stamp(now)});
            let key = format!(
                "{}/{}-{}",
                &stamp(now)[..10],
                9999999999999u64 - now as u64,
                text(req, "uuid")
            );
            set(a, &lift_store, &key, &report, &json!({})).await?;
            return Ok(reply(json!({"report":report}), 201, origin, ""));
        }
        let mut reports = Vec::new();
        for time in [now, now - 86400000.] {
            let listed = call(
                a,
                "list_page",
                &lift_store,
                "",
                JsValue::NULL,
                &json!({"prefix":format!("{}/",&stamp(time)[..10])}),
            )
            .await?;
            if let Some(blobs) = listed["blobs"].as_array() {
                let keys = blobs
                    .iter()
                    .take(100)
                    .map(|b| text(b, "key").to_string())
                    .collect::<Vec<_>>();
                let promises = js_sys::Array::new();
                for key in keys {
                    let adapter = a.clone();
                    let store = lift_store.clone();
                    promises.push(&wasm_bindgen_futures::future_to_promise(async move {
                        js(&get(&adapter, &store, &key).await?)
                    }));
                }
                let values = JsFuture::from(js_sys::Promise::all(&promises)).await?;
                let values: Vec<Value> =
                    serde_wasm_bindgen::from_value(values).map_err(|e| e.to_string())?;
                for report in values {
                    let age = now - parse_time(text(&report, "observedAt"));
                    if age >= 0.
                        && age < 86400000.
                        && ["working", "intermittent", "out-of-service"]
                            .contains(&text(&report, "status"))
                    {
                        reports.push(report);
                    }
                }
            }
        }
        reports.sort_by(|a, b| text(b, "observedAt").cmp(text(a, "observedAt")));
        reports.truncate(100);
        return Ok(reply(
            json!({"reports":reports,"fetchedAt":stamp(now)}),
            200,
            origin,
            if cache.is_empty() {
                ""
            } else {
                "public, durable, s-maxage=60, stale-while-revalidate=30"
            },
        ));
    }
    if path == "/api/timetable" && method == "GET" {
        let q = &req["query"];
        let resource = if text(q, "resource").is_empty() {
            "manifest"
        } else {
            text(q, "resource")
        };
        if resource == "manifest" {
            let data = get(a, &tt_store, "current").await?;
            return Ok(if data.is_null() {
                reply(
                    json!({"error":"No community timetable published."}),
                    404,
                    origin,
                    cache,
                )
            } else {
                reply(data, 200, origin, cache)
            });
        }
        let release = text(q, "release");
        let id = text(q, "id");
        if release.len() != 64
            || !release
                .chars()
                .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
            || !["class", "lecturer"].contains(&resource)
            || id.is_empty()
            || id.len() > 20
            || !id
                .chars()
                .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
        {
            return Ok(error("Invalid dataset.", 400, origin));
        }
        let data = get(a, &tt_store, &format!("releases/{release}/{resource}/{id}")).await?;
        return Ok(if data.is_null() {
            error("Dataset unavailable.", 404, origin)
        } else {
            reply(
                data,
                200,
                origin,
                "public, durable, s-maxage=31536000, immutable",
            )
        });
    }
    if path != "/api/publish-timetable" || method != "POST" {
        return Ok(error("Method not allowed.", 405, origin));
    }
    if !owned {
        return Ok(error("Submit from the timetable website.", 403, origin));
    }
    if !text(req, "contentType").starts_with("application/octet-stream") {
        return Ok(error("DAV binary required.", 415, origin));
    }
    if bytes.len() > 4 * 1024 * 1024 {
        return Ok(error(
            "Shared DAV uploads must be 4 MB or smaller.",
            413,
            origin,
        ));
    }
    let filename = js_sys::decode_uri_component(text(req, "filename"))
        .map(|s| s.as_string().unwrap_or_default())
        .unwrap_or_default();
    let re = regex::Regex::new(
        r"(?i)^[\w .()-]{1,120}_([A-Z][A-Z0-9]{1,12})_(\d{2})(\d{2})(\d{4})\.dav$",
    )
    .unwrap();
    let Some(c) = re.captures(&filename) else {
        return Ok(error("Use the original revision filename ending _R04D_15102026.dav (revision and DDMMYYYY date).",400,origin));
    };
    let date_string = format!("{}-{}-{}", &c[4], &c[3], &c[2]);
    let today = &stamp(now + 28800000.)[..10];
    if date(&date_string).is_err()
        || date_string.as_str() < "2026-10-15"
        || date_string.as_str() > today
    {
        return Ok(error("The filename must contain a valid revision date, no older than the provided timetable and no later than today (MYT).",400,origin));
    }
    let mut decoded =
        match timetable_core::dav::decode_for_publish(bytes, &filename) {
            Ok(d) => d,
            Err(_) => return Ok(error(
                "Validation failed: this is not a fully decodable supported DaVinci V30 timetable.",
                400,
                origin,
            )),
        };
    let manifest = &decoded["manifest"];
    if decoded["total"].as_u64().unwrap_or(0) == 0
        || decoded["total"].as_u64().unwrap_or(0) > 100000
        || manifest["classes"].as_array().map(Vec::len).unwrap_or(0) > 500
        || manifest["lecturers"].as_array().map(Vec::len).unwrap_or(0) > 750
    {
        return Ok(error(
            "Validation failed: empty or excessively large timetable.",
            400,
            origin,
        ));
    }
    let current = call(
        a,
        "metadata",
        &tt_store,
        "current",
        JsValue::NULL,
        &json!({}),
    )
    .await?;
    if text(&current["data"], "sourceHash") == text(manifest, "sourceHash") {
        return Ok(reply(
            json!({"manifest":current["data"],"unchanged":true}),
            200,
            origin,
            "",
        ));
    }
    if text(&current["data"], "sourceRevisionDate") > date_string.as_str() {
        return Ok(error(
            "A newer dated timetable is already published.",
            409,
            origin,
        ));
    }
    let all = decoded["lecturerEvents"].as_array().unwrap().clone();
    let mut grouped = BTreeMap::<String, Vec<Value>>::new();
    for e in &all {
        if !text(e, "lecturer").is_empty() {
            grouped
                .entry(text(e, "lecturer").into())
                .or_default()
                .push(e.clone());
        }
    }
    let mut lecturers = Vec::new();
    let mut tasks = Vec::new();
    for (name, mut events) in grouped {
        events.sort_by(|a, b| {
            text(a, "date")
                .cmp(text(b, "date"))
                .then(text(a, "start").cmp(text(b, "start")))
        });
        timetable_core::dav::mark_overlaps(&mut events);
        let hash = format!("{:x}", Sha256::digest(name.as_bytes()));
        let item = json!({"id":&hash[..16],"name":name,"eventCount":events.len(),"firstDate":text(&events[0],"date"),"lastDate":text(events.last().unwrap(),"date")});
        tasks.push((
            format!("lecturer/{}", &hash[..16]),
            json!({"class":item,"events":events}),
        ));
        lecturers.push(item);
    }
    let mut manifest = decoded["manifest"].take();
    manifest["lecturers"] = json!(lecturers);
    manifest["communityUpload"] = json!(true);
    manifest["publishedAt"] = json!(stamp(now));
    manifest["sourceRevision"] = json!(date_string);
    manifest["sourceRevisionDate"] = json!(date_string);
    manifest["revisionCode"] = json!(c[1].to_uppercase());
    manifest["sourceFilename"] = json!(filename);
    manifest["sourceBytes"] = json!(bytes.len());
    manifest["omittedSlots"] = decoded["omitted"].clone();
    manifest["counts"] = json!({"classes":manifest["classes"].as_array().unwrap().len(),"studentEvents":decoded["total"],"allEvents":all.len()});
    manifest.as_object_mut().unwrap().remove("filename");
    let hash = text(&manifest, "sourceHash").to_string();
    for (id, dataset) in decoded["datasets"].as_object().unwrap() {
        tasks.push((format!("class/{id}"), dataset.clone()));
    }
    // The bounded parallel batches finish before the single conditional publication.
    for batch in tasks.chunks(20) {
        let promises = js_sys::Array::new();
        for (key, data) in batch {
            let adapter = a.clone();
            let store = tt_store.clone();
            let key = format!("releases/{hash}/{key}");
            let data = data.clone();
            promises.push(&wasm_bindgen_futures::future_to_promise(async move {
                set(&adapter, &store, &key, &data, &json!({}))
                    .await
                    .map(|_| JsValue::NULL)
            }));
        }
        JsFuture::from(js_sys::Promise::all(&promises)).await?;
    }
    call(
        a,
        "set_bytes",
        &tt_store,
        &format!("releases/{hash}/source.dav"),
        js_sys::Uint8Array::from(bytes).into(),
        &json!({}),
    )
    .await?;
    set(
        a,
        &tt_store,
        &format!("releases/{hash}/manifest"),
        &manifest,
        &json!({}),
    )
    .await?;
    let changed = set(
        a,
        &tt_store,
        "current",
        &manifest,
        &if current.is_null() {
            json!({"onlyIfNew":true})
        } else {
            json!({"onlyIfMatch":current["etag"]})
        },
    )
    .await?;
    if changed["modified"] != true {
        return Ok(error(
            "Another timetable was published while validating. Reload before submitting again.",
            409,
            origin,
        ));
    }
    Ok(reply(json!({"manifest":manifest}), 201, origin, ""))
}
async fn cleanup(req: &Value, a: &JsValue, lifts: &str, tt: &str) -> Result<Value, JsValue> {
    let now = req["now"].as_f64().unwrap_or(0.);
    let mut removed = 0;
    if text(req, "path") == "/internal/prune-lifts" {
        let listed = call(a, "list", lifts, "", JsValue::NULL, &json!({})).await?;
        let cutoff = &stamp(now - 7. * 86400000.)[..10];
        for row in listed["blobs"].as_array().unwrap_or(&Vec::new()) {
            let key = text(row, "key");
            if key.len() > 10 && &key[..10] < cutoff {
                call(a, "delete", lifts, key, JsValue::NULL, &json!({})).await?;
                removed += 1;
            }
        }
    } else {
        let current = get(a, tt, "current").await?;
        let listed = call(
            a,
            "list",
            tt,
            "",
            JsValue::NULL,
            &json!({"prefix":"releases/","directories":true}),
        )
        .await?;
        for prefix in listed["directories"].as_array().unwrap_or(&Vec::new()) {
            let prefix = prefix.as_str().unwrap_or("");
            if prefix == format!("releases/{}/", text(&current, "sourceHash")) {
                continue;
            }
            let manifest = get(a, tt, &format!("{prefix}manifest")).await?;
            if manifest.is_null()
                || parse_time(text(&manifest, "publishedAt")) >= now - 7. * 86400000.
            {
                continue;
            }
            let blobs = call(a, "list", tt, "", JsValue::NULL, &json!({"prefix":prefix})).await?;
            for row in blobs["blobs"].as_array().unwrap_or(&Vec::new()) {
                call(a, "delete", tt, text(row, "key"), JsValue::NULL, &json!({})).await?;
                removed += 1;
            }
        }
    }
    Ok(reply(
        json!({"removed":removed}),
        200,
        text(req, "origin"),
        "",
    ))
}
