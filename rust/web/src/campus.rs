use super::*;
thread_local! {static SERVICE:RefCell<Option<String>>=const{RefCell::new(None)};static AIR:RefCell<Value>=const{RefCell::new(Value::Null)};static AIR_LAST:RefCell<f64>=const{RefCell::new(0.)};static AIR_ERROR:RefCell<bool>=const{RefCell::new(false)};}
pub fn haze_active() -> bool {
    today() >= "2026-10-18".to_string() && today() <= "2026-10-25".to_string()
}
pub fn render_haze() {
    hidden("#haze-advisory", !haze_active());
    hidden("#haze-brief", !haze_active());
    let collapsed = stored("kajang-haze-2026-10-18-collapsed") == "true";
    hidden("#haze-details", collapsed);
    attr(
        "#haze-toggle",
        "aria-expanded",
        if collapsed { "false" } else { "true" },
    );
    txt(
        "#haze-toggle",
        if collapsed {
            "Show haze reminder"
        } else {
            "Hide haze reminder"
        },
    );
    attr(
        "#haze-air-link",
        "href",
        "https://eqms.doe.gov.my/APIMS/main",
    );
    attr("#haze-health-link","href","https://www.moh.gov.my/teras/info-kesihatan/jerebu/artikel-dan-panduan-pengguna-berkaitan-jerebu/usage-of-personal-protection-during-haze");
}
async fn service() -> String {
    if let Some(value) = SERVICE.with(|s| s.borrow().clone()) {
        return value;
    }
    let response = fetch("./data/lift-service.json", "GET", None, &[])
        .await
        .unwrap_or(Value::Null);
    let endpoint = text(&response, "endpoint");
    let valid = Url::new(endpoint)
        .ok()
        .map(|u| {
            u.protocol() == "https:"
                && u.hostname().ends_with(".netlify.app")
                && u.pathname() == "/api/lifts"
                && u.port().is_empty()
        })
        .unwrap_or(false);
    let value = if valid {
        endpoint.to_string()
    } else {
        String::new()
    };
    SERVICE.with(|s| *s.borrow_mut() = Some(value.clone()));
    value
}
fn fresh(url: &str, force: bool) -> String {
    if force {
        format!("{url}?fresh={}", js_sys::Date::now() as u64)
    } else {
        url.to_string()
    }
}
pub async fn check_community(force: bool) {
    if read(|s| s.local) {
        return;
    }
    let request = read(|s| s.request);
    let endpoint = service().await.replace("/lifts", "/timetable");
    if endpoint.is_empty() {
        return;
    }
    let key = "timetable-community-cache-v1";
    let cached: Value = serde_json::from_str(&stored(key)).unwrap_or(Value::Null);
    let age = js_sys::Date::now() - cached["checked"].as_f64().unwrap_or(0.);
    let manifest = if !force && age >= 0. && age < 300000. {
        cached["manifest"].clone()
    } else {
        let result = fetch(&fresh(&endpoint, force), "GET", None, &[]).await;
        match result {
            Ok(value) => {
                save(
                    key,
                    &json!({"checked":js_sys::Date::now(),"manifest":value}).to_string(),
                );
                value
            }
            Err(e) if e == "not-found" => {
                save(
                    key,
                    &json!({"checked":js_sys::Date::now(),"manifest":null}).to_string(),
                );
                return;
            }
            _ => return,
        }
    };
    if read(|s| s.local || s.request != request)
        || manifest["communityUpload"] != true
        || text(&manifest, "sourceHash").len() != 64
        || !manifest["classes"].is_array()
        || !manifest["lecturers"].is_array()
    {
        return;
    }
    if read(|s| text(&s.manifest, "sourceHash") == text(&manifest, "sourceHash")) {
        return;
    }
    let selected = read(|s| text(&s.selected, "id").to_string());
    let mut manifest = manifest;
    manifest["serviceEndpoint"] = json!(endpoint);
    update(|s| {
        s.manifest = manifest;
        s.cache.clear();
        s.week = clamp_week(
            &s.week,
            text(&s.manifest, "planningStart"),
            text(&s.manifest, "planningEnd"),
        );
        s.selected = Value::Null;
        s.events.clear();
        s.loading = false;
        s.error.clear();
    });
    if read(|s| choices(s).iter().any(|c| text(c, "id") == selected)) {
        select(&selected, true).await;
    } else {
        render();
    }
    toast("Community timetable loaded. Confirm changes with your lecturer.");
}
pub async fn load_lifts(force: bool) {
    txt("#lift-results", "Loading community observations…");
    let endpoint = service().await;
    if endpoint.is_empty() {
        txt(
            "#lift-results",
            "Shared reporting is not connected yet. No lift condition is known.",
        );
        hidden("#lift-form", true);
        return;
    }
    match fetch(&fresh(&endpoint, force), "GET", None, &[]).await {
        Ok(data) => {
            let mut reports = data["reports"].as_array().cloned().unwrap_or_default();
            reports.sort_by(|a, b| text(b, "observedAt").cmp(text(a, "observedAt")));
            let mut seen = BTreeSet::new();
            let mut output = String::new();
            for r in reports {
                let time = js_sys::Date::parse(text(&r, "observedAt"));
                let age = js_sys::Date::now() - time;
                if !age.is_finite() || age < 0. || age >= 86400000. {
                    continue;
                }
                let label = match text(&r, "status") {
                    "working" => "Reported working",
                    "intermittent" => "Reported intermittent",
                    "out-of-service" => "Reported out of service",
                    _ => continue,
                };
                let key = format!(
                    "{}\0{}",
                    text(&r, "building").trim().to_lowercase(),
                    text(&r, "lift").trim().to_lowercase()
                );
                if !seen.insert(key) {
                    continue;
                }
                output+=&format!("<li><strong>{} · {}</strong><span>{label}</span><small>Observed {}{}</small></li>",esc(text(&r,"building")),esc(text(&r,"lift")),air_time(text(&r,"observedAt")),if age>7200000.{" · Older report; condition may have changed"}else{""});
            }
            html(
                "#lift-results",
                &if output.is_empty() {
                    "<p>No observations in the last 24 hours. Lift conditions are unknown.</p>"
                        .into()
                } else {
                    format!("<ul class=\"lift-list\">{output}</ul>")
                },
            );
        }
        Err(_) => txt(
            "#lift-results",
            "Could not load lift reports. Conditions are unknown. Please retry.",
        ),
    }
}
pub async fn submit_lift() {
    disabled("#lift-form [type=submit]", true);
    txt("#lift-feedback", "Sending observation…");
    let endpoint = service().await;
    let body=json!({"building":val("#lift-building"),"lift":val("#lift-unit"),"status":val("#lift-condition"),"website":val("#lift-form [name=website]")}).to_string();
    match fetch(
        &endpoint,
        "POST",
        Some(body.into()),
        &[("Content-Type", "application/json")],
    )
    .await
    {
        Ok(_) => {
            txt("#lift-feedback","Observation shared. Thank you. This is a community report, not an official maintenance notice.");
            el("#lift-form")
                .dyn_into::<HtmlFormElement>()
                .unwrap()
                .reset();
            load_lifts(true).await;
        }
        Err(error) => txt("#lift-feedback", &error),
    }
    disabled("#lift-form [type=submit]", false);
}
pub async fn publish() {
    let input = el("#publish-file").dyn_into::<HtmlInputElement>().unwrap();
    let Some(file) = input.files().and_then(|f| f.get(0)) else {
        return;
    };
    if file.size() > 4. * 1024. * 1024. {
        txt(
            "#publish-feedback",
            "Shared uploads must be 4 MB or smaller. Larger files can still be opened locally.",
        );
        return;
    }
    disabled("#publish-form [type=submit]", true);
    txt(
        "#publish-feedback",
        "Validating and publishing… Keep this dialog open.",
    );
    let endpoint = service().await.replace("/lifts", "/publish-timetable");
    if endpoint.is_empty() {
        txt(
            "#publish-feedback",
            "Shared publishing is not connected yet.",
        );
        disabled("#publish-form [type=submit]", false);
        return;
    }
    let filename = js_sys::encode_uri_component(&file.name())
        .as_string()
        .unwrap();
    let body: JsValue = file.into();
    match fetch(
        &endpoint,
        "POST",
        Some(body),
        &[
            ("Content-Type", "application/octet-stream"),
            ("X-Timetable-Filename", &filename),
        ],
    )
    .await
    {
        Ok(data) => {
            txt(
                "#publish-feedback",
                if data["unchanged"] == true {
                    "This file is already published."
                } else {
                    "Published. This is now the shared default timetable."
                },
            );
            check_community(true).await;
        }
        Err(error) => txt("#publish-feedback", &error),
    }
    disabled("#publish-form [type=submit]", false);
}
fn air_time(value: &str) -> String {
    let n = js_sys::Date::parse(value);
    chrono::DateTime::from_timestamp((n / 1000.) as i64 + 28800, 0)
        .map(|d| d.format("%-d %b %Y, %H:%M MYT").to_string())
        .unwrap_or("Time unavailable".into())
}
pub fn render_air() {
    let id = val("#air-station");
    let name = if id == "CA16W" { "Cheras" } else { "Putrajaya" };
    AIR.with(|snapshot|{let data=snapshot.borrow();let row=data["stations"].as_array().and_then(|a|a.iter().find(|r|text(r,"id")==id)).cloned().unwrap_or(Value::Null);let value=row["value"].as_u64();let category=match value{Some(0..=50)=>"Good",Some(51..=100)=>"Moderate",Some(101..=200)=>"Unhealthy",Some(201..=300)=>"Very Unhealthy",Some(301..=1000)=>"Hazardous",_=>""};let time=js_sys::Date::parse(text(&row,"observedAt"));let fetched=js_sys::Date::parse(text(&data,"fetchedAt"));let age=js_sys::Date::now()-time;let valid=data["schemaVersion"]==1&&!category.is_empty()&&category==text(&row,"category")&&time.is_finite()&&fetched.is_finite()&&age>=-900000.&&age<=86400000.&&time<=fetched+900000.&&fetched<=js_sys::Date::now()+900000.;if !valid{txt("#air-brief",&format!("{name} · Air reading unavailable"));html("#air-result","<p><strong>Reading unavailable</strong></p><p>No recent verified reading is available here. Check the official APIMS source.</p>");attr("#air-result","data-state","unavailable");return;}let stale=age>10800000.;let when=air_time(text(&row,"observedAt"));txt("#air-brief",&format!("{name} · API {} {category}{} · {when}",value.unwrap(),if stale{" · Outdated"}else{""}));attr("#air-result","data-state",if stale{"stale"}else{"fresh"});html("#air-result",&format!("<p class=\"air-value\"><strong>{}</strong><span>API / IPU · {category}</span></p><p><strong>{}</strong> · {when}</p>{}{}",value.unwrap(),if stale{"Outdated reading"}else{"Latest available reading"},if stale{"<p>Older than 3 hours. This is a last-known reading, not current conditions.</p>"}else{""},if AIR_ERROR.with(|e|*e.borrow()){"<p>Refresh failed; showing the last retrieved reading with its original timestamp.</p>"}else{""}));});
}
pub async fn load_air() {
    if el("#air-quality").get_attribute("aria-busy").as_deref() == Some("loading") {
        return;
    }
    AIR_LAST.with(|t| *t.borrow_mut() = js_sys::Date::now());
    if el("#air-station").child_element_count() == 0 {
        html("#air-station","<option value=\"CA17W\">Putrajaya, W.P. PUTRAJAYA</option><option value=\"CA16W\">Cheras, W.P. KUALA LUMPUR</option>");
        let id = stored("timetable-air-station");
        if id == "CA16W" {
            setval("#air-station", &id);
        }
    }
    attr("#air-source", "href", "https://eqms.doe.gov.my/APIMS/main");
    attr("#air-quality", "aria-busy", "true");
    disabled("#air-refresh", true);
    match fetch("./data/air-quality.json", "GET", None, &[]).await {
        Ok(value) if value["schemaVersion"] == 1 && value["stations"].is_array() => {
            AIR.with(|s| *s.borrow_mut() = value);
            AIR_ERROR.with(|e| *e.borrow_mut() = false);
        }
        _ => AIR_ERROR.with(|e| *e.borrow_mut() = true),
    }
    attr("#air-quality", "aria-busy", "false");
    disabled("#air-refresh", false);
    render_air();
}

pub fn age_tick() {
    render_haze();
    render_air();
    if !doc().hidden() && AIR_LAST.with(|t| js_sys::Date::now() - *t.borrow() >= 900000.) {
        spawn_local(load_air());
    }
}
