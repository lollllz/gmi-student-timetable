use serde_json::{json, Value};
use std::{
    cell::RefCell,
    collections::{BTreeSet, HashMap},
};
use timetable_core::{
    add_days, calendar, clamp_week, class_details, esc, filtered, minutes, monday, search_classes,
    text,
};
use wasm_bindgen::{prelude::*, JsCast};
use wasm_bindgen_futures::{spawn_local, JsFuture};
use web_sys::*;

mod campus;
fn win() -> Window {
    web_sys::window().unwrap()
}
fn doc() -> Document {
    win().document().unwrap()
}
fn el(q: &str) -> Element {
    doc().query_selector(q).unwrap().unwrap()
}
fn maybe(q: &str) -> Option<Element> {
    doc().query_selector(q).ok().flatten()
}
fn html(q: &str, s: &str) {
    if el(q).inner_html() != s {
        el(q).set_inner_html(s);
    }
}
fn txt(q: &str, s: &str) {
    if el(q).text_content().as_deref() != Some(s) {
        el(q).set_text_content(Some(s));
    }
}
fn attr(q: &str, k: &str, v: &str) {
    let _ = el(q).set_attribute(k, v);
}
fn hidden(q: &str, yes: bool) {
    if yes {
        attr(q, "hidden", "")
    } else {
        let _ = el(q).remove_attribute("hidden");
    }
}
fn disabled(q: &str, yes: bool) {
    if yes {
        attr(q, "disabled", "")
    } else {
        let _ = el(q).remove_attribute("disabled");
    }
}
fn val(q: &str) -> String {
    let e = el(q);
    if let Some(e) = e.dyn_ref::<HtmlInputElement>() {
        e.value()
    } else if let Some(e) = e.dyn_ref::<HtmlSelectElement>() {
        e.value()
    } else {
        js_sys::Reflect::get(&e, &"value".into())
            .unwrap_or_default()
            .as_string()
            .unwrap_or_default()
    }
}
fn setval(q: &str, v: &str) {
    let _ = js_sys::Reflect::set(&el(q), &"value".into(), &v.into());
}
fn checked(q: &str) -> bool {
    el(q)
        .dyn_into::<HtmlInputElement>()
        .map(|e| e.checked())
        .unwrap_or(false)
}
fn focus(q: &str) {
    if let Some(e) = maybe(q).and_then(|e| e.dyn_into::<HtmlElement>().ok()) {
        let _ = e.focus();
    }
}
fn stored(key: &str) -> String {
    win()
        .local_storage()
        .ok()
        .flatten()
        .and_then(|s| s.get_item(key).ok().flatten())
        .unwrap_or_default()
}
fn save(key: &str, value: &str) {
    if let Ok(Some(s)) = win().local_storage() {
        let _ = s.set_item(key, value);
    }
}
fn open(q: &str) {
    let d = el(q).dyn_into::<HtmlDialogElement>().unwrap();
    if !d.open() {
        let _ = d.show_modal();
    }
}
fn close(q: &str) {
    el(q).dyn_into::<HtmlDialogElement>().unwrap().close();
}
fn mobile() -> bool {
    win()
        .match_media("(max-width: 700px)")
        .ok()
        .flatten()
        .map(|m| m.matches())
        .unwrap_or(false)
}
fn today() -> String {
    let seconds = (js_sys::Date::now() / 1000.) as i64 + 28800;
    chrono::DateTime::from_timestamp(seconds, 0)
        .unwrap()
        .date_naive()
        .to_string()
}
fn fmt(s: &str, pattern: &str) -> String {
    timetable_core::date(s)
        .map(|d| d.format(pattern).to_string())
        .unwrap_or_default()
}
fn weeklabel(week: &str) -> String {
    let end = add_days(week, 6);
    format!(
        "{} – {}",
        fmt(
            week,
            if week.get(..7) == end.get(..7) {
                "%-d"
            } else {
                "%-d %b"
            }
        ),
        fmt(&end, "%-d %b %Y")
    )
}

fn all(q: &str) -> Vec<Element> {
    let nodes = doc().query_selector_all(q).unwrap();
    (0..nodes.length())
        .filter_map(|i| nodes.item(i)?.dyn_into::<Element>().ok())
        .collect()
}
fn toast(s: &str) {
    txt("#toast", s);
    hidden("#toast", false);
    let f = Closure::once_into_js(|| hidden("#toast", true));
    let _ = win().set_timeout_with_callback_and_timeout_and_arguments_0(f.unchecked_ref(), 5000);
}
#[derive(Default)]
struct State {
    manifest: Value,
    selected: Value,
    events: Vec<Value>,
    cache: HashMap<String, Value>,
    week: String,
    day: String,
    mode: String,
    view: String,
    query: String,
    error: String,
    loading: bool,
    local: bool,
    bytes: Vec<u8>,
    editor: Value,
    edit_id: String,
    request: u64,
    import: u64,
    worker: Option<Worker>,
    blob: String,
}
thread_local! {static STATE:RefCell<State>=RefCell::new(State{week:monday(&today()),day:today(),mode:"class".into(),view:"week".into(),..Default::default()});}
fn read<T>(f: impl FnOnce(&State) -> T) -> T {
    STATE.with(|s| f(&s.borrow()))
}
fn update(f: impl FnOnce(&mut State)) {
    STATE.with(|s| f(&mut s.borrow_mut()));
}
fn choices(s: &State) -> Vec<Value> {
    s.manifest[if s.mode == "lecturer" {
        "lecturers"
    } else {
        "classes"
    }]
    .as_array()
    .cloned()
    .unwrap_or_default()
}
async fn fetch(
    path: &str,
    method: &str,
    body: Option<JsValue>,
    headers: &[(&str, &str)],
) -> Result<Value, String> {
    let init = RequestInit::new();
    init.set_method(method);
    init.set_credentials(if path.starts_with("./") {
        RequestCredentials::SameOrigin
    } else {
        RequestCredentials::Omit
    });
    if let Some(body) = body.as_ref() {
        init.set_body(body);
    }
    let request =
        Request::new_with_str_and_init(path, &init).map_err(|_| "Could not start request")?;
    for (k, v) in headers {
        request.headers().set(k, v).map_err(|_| "Invalid header")?;
    }
    let controller = AbortController::new().map_err(|_| "Could not start request")?;
    let c = controller.clone();
    let abort = Closure::once_into_js(move || c.abort());
    let timer = win()
        .set_timeout_with_callback_and_timeout_and_arguments_0(
            abort.unchecked_ref(),
            if method == "POST" { 60000 } else { 10000 },
        )
        .unwrap_or(0);
    // Attach a timeout signal without disabling browser/CDN caching of public reads.
    let init = RequestInit::new();
    init.set_signal(Some(&controller.signal()));
    let request = Request::new_with_request_and_init(&request, &init)
        .map_err(|_| "Could not start request")?;
    let result = async {
        let response = JsFuture::from(win().fetch_with_request(&request))
            .await
            .map_err(|_| "Could not reach the service. Refresh before retrying.")?
            .dyn_into::<Response>()
            .map_err(|_| "Invalid response")?;
        if !response.ok() {
            if response.status() == 404 {
                return Err("not-found".into());
            }
            if response.status() == 429 {
                return Err("Too many requests. Please wait and retry.".into());
            }
            let status = response.status();
            let body = JsFuture::from(response.text().map_err(|_| "Invalid response")?)
                .await
                .ok()
                .and_then(|v| v.as_string())
                .unwrap_or_default();
            let parsed: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
            return Err(if text(&parsed, "error").is_empty() {
                format!("Service unavailable ({status}). Please retry.")
            } else {
                text(&parsed, "error").to_string()
            });
        }
        let body = JsFuture::from(response.text().map_err(|_| "Invalid response")?)
            .await
            .map_err(|_| "Invalid response")?
            .as_string()
            .ok_or("Invalid response")?;
        serde_json::from_str(&body).map_err(|_| "Invalid response".into())
    }
    .await;
    win().clear_timeout_with_handle(timer);
    result
}
fn update_url() {
    read(|s| {
        let url = Url::new(&win().location().href().unwrap()).unwrap();
        url.set_search("");
        if !s.local && !s.selected.is_null() {
            url.search_params().set(&s.mode, text(&s.selected, "id"));
            url.search_params().set("week", &s.week);
        }
        let _ =
            win()
                .history()
                .unwrap()
                .replace_state_with_url(&JsValue::NULL, "", Some(&url.href()));
    });
}
async fn initialize() {
    update(|s| {
        s.loading = true;
        s.error.clear();
        s.local = false;
        s.bytes.clear();
        s.editor = Value::Null;
        s.cache.clear();
        s.events.clear();
        s.selected = Value::Null;
        s.mode = "class".into();
        s.request += 1;
    });
    render();
    match fetch("./data/manifest.json", "GET", None, &[]).await {
        Ok(manifest) => {
            let url = Url::new(&win().location().href().unwrap()).unwrap();
            let mode = if url.search_params().has("lecturer") {
                "lecturer"
            } else {
                "class"
            };
            let id = url.search_params().get(mode).unwrap_or_else(|| {
                if mode == "class" {
                    stored("gmi-student-class")
                } else {
                    String::new()
                }
            });
            update(|s| {
                s.manifest = manifest;
                s.loading = false;
                s.mode = mode.into();
                let d = url
                    .search_params()
                    .get("week")
                    .filter(|d| timetable_core::date(d).is_ok())
                    .unwrap_or(today());
                s.week = clamp_week(
                    &d,
                    text(&s.manifest, "planningStart"),
                    text(&s.manifest, "planningEnd"),
                );
                s.day = if today() >= s.week && today() <= add_days(&s.week, 6) {
                    today()
                } else {
                    s.week.clone()
                };
            });
            if read(|s| choices(s).iter().any(|c| text(c, "id") == id)) {
                select(&id, true).await;
            } else {
                render();
            }
        }
        Err(_) => {
            update(|s| {
                s.loading = false;
                s.error =
                    "We couldn’t load the class list. Check your connection and try again.".into();
            });
            render();
        }
    }
}
async fn select(id: &str, preserve: bool) {
    let item = read(|s| choices(s).into_iter().find(|c| text(c, "id") == id));
    let Some(item) = item else { return };
    let picker = el("#class-dialog")
        .dyn_into::<HtmlDialogElement>()
        .unwrap()
        .open();
    close("#class-dialog");
    let (key, path, request) = STATE.with(|cell| {
        let mut s = cell.borrow_mut();
        s.selected = item;
        s.loading = true;
        s.error.clear();
        s.query.clear();
        s.events.clear();
        s.request += 1;
        if !preserve {
            s.week = clamp_week(
                &today(),
                text(&s.manifest, "planningStart"),
                text(&s.manifest, "planningEnd"),
            );
        }
        let key = format!("{}/{}", s.mode, id);
        let path = if !text(&s.manifest, "serviceEndpoint").is_empty() {
            format!(
                "{}?resource={}&id={}&release={}",
                text(&s.manifest, "serviceEndpoint"),
                s.mode,
                id,
                text(&s.manifest, "sourceHash")
            )
        } else if s.mode == "lecturer" {
            format!("./lecturers/{id}.json")
        } else {
            format!("./data/{id}.json")
        };
        (key, path, s.request)
    });
    setval("#subject-search", "");
    if read(|s| !s.local && s.mode == "class") {
        save("gmi-student-class", id);
    }
    update_url();
    render();
    let cached = read(|s| s.cache.get(&key).cloned());
    let result = if let Some(value) = cached {
        Ok(value)
    } else {
        fetch(&path, "GET", None, &[]).await
    };
    if request != read(|s| s.request) {
        return;
    }
    match result {
        Ok(data) if text(&data["class"], "id") == id && data["events"].is_array() => {
            update(|s| {
                s.events = data["events"].as_array().unwrap().clone();
                s.cache.insert(key, data);
                s.loading = false;
            });
            render();
            if picker {
                focus("#main");
            }
            toast(&format!(
                "{} timetable loaded.",
                read(|s| text(&s.selected, "name").to_string())
            ));
        }
        _ => {
            update(|s| {
                s.loading = false;
                s.error =
                    "We couldn’t load this class’s timetable. Check your connection and try again."
                        .into();
            });
            render();
        }
    }
}
fn set_week(d: &str) {
    if timetable_core::date(d).is_err() {
        return;
    }
    update(|s| {
        s.week = clamp_week(
            d,
            text(&s.manifest, "planningStart"),
            text(&s.manifest, "planningEnd"),
        );
        s.day = if today() >= s.week && today() <= add_days(&s.week, 6) {
            today()
        } else {
            s.week.clone()
        };
    });
    update_url();
    render();
}
fn picker() {
    let (mode, details) = read(|s| {
        (
            s.mode.clone(),
            s.manifest["classes"]
                .as_array()
                .cloned()
                .unwrap_or_default()
                .iter()
                .map(|c| class_details(text(c, "name")))
                .collect::<Vec<_>>(),
        )
    });
    txt(
        "#class-dialog-title",
        if mode == "lecturer" {
            "Find a lecturer"
        } else {
            "Find your class"
        },
    );
    attr(
        "#class-search",
        "aria-label",
        if mode == "lecturer" {
            "Search lecturers"
        } else {
            "Search classes"
        },
    );
    attr(
        "#class-search",
        "placeholder",
        if mode == "lecturer" {
            "Search lecturer name…"
        } else {
            "Try semester 3 dmch or dswe group 2…"
        },
    );
    hidden(".class-filters", mode == "lecturer");
    setval("#class-search", "");
    for (q, key, label) in [
        ("#programme-filter", "programmes", "All programmes"),
        ("#semester-filter", "semester", "All semesters"),
        ("#group-filter", "group", "All groups"),
    ] {
        let mut values = BTreeSet::new();
        for d in &details {
            if let Some(a) = d[key].as_array() {
                for v in a {
                    if let Some(v) = v.as_str() {
                        values.insert(v.to_string());
                    }
                }
            } else if !text(d, key).is_empty() {
                values.insert(text(d, key).to_string());
            }
        }
        let options = values
            .into_iter()
            .map(|v| {
                format!(
                    "<option value=\"{}\">{}{}</option>",
                    esc(&v),
                    if key == "semester" {
                        "Semester "
                    } else if key == "group" {
                        "Group / team "
                    } else {
                        ""
                    },
                    esc(&v)
                )
            })
            .collect::<String>();
        html(q, &format!("<option value=\"\">{label}</option>{options}"));
    }
    class_results();
    open("#class-dialog");
    focus("#class-search");
}
fn class_results() {
    let query = val("#class-search");
    let filters = json!({"programme":val("#programme-filter"),"semester":val("#semester-filter"),"group":val("#group-filter")});
    let rows = read(|s| {
        let rows = choices(s);
        if s.mode == "lecturer" {
            rows.into_iter()
                .filter(|r| {
                    query
                        .to_lowercase()
                        .split_whitespace()
                        .all(|w| text(r, "name").to_lowercase().contains(w))
                })
                .collect::<Vec<_>>()
        } else {
            search_classes(&rows, &query, &filters)
        }
    });
    txt(
        "#class-result-count",
        &format!(
            "{} {}",
            rows.len(),
            if read(|s| s.mode == "lecturer") {
                "lecturer / resource timetables"
            } else {
                "classes available"
            }
        ),
    );
    let selected = read(|s| text(&s.selected, "id").to_string());
    let output=rows.iter().map(|c|format!("<button class=\"class-option {}\" data-class-id=\"{}\" {}><span><strong>{}</strong><small>{}{} dated entries · calendar available</small></span><span aria-hidden=\"true\">›</span></button>",if text(c,"id")==selected{"selected"}else{""},esc(text(c,"id")),if text(c,"id")==selected{"aria-current=\"true\""}else{""},esc(text(c,"name")),if c["fuzzy"]==true{"Close match · "}else{""},c["eventCount"].as_u64().unwrap_or(0))).collect::<String>();
    html(
        "#class-results",
        if output.is_empty() {
            "<p class=\"picker-empty\">No matching class. Try fewer words or clear the filters.</p>"
        } else {
            &output
        },
    );
}
fn panel(title: &str, description: &str, action: &str, label: &str) -> String {
    format!(
        "<div class=\"state-panel\"><h2>{}</h2><p>{}</p>{}</div>",
        esc(title),
        esc(description),
        if action.is_empty() {
            String::new()
        } else {
            format!("<button class=\"button primary\" data-action=\"{action}\">{label}</button>")
        }
    )
}
fn mode_reminder(e: &Value) -> String {
    let note = text(e, "note").to_lowercase();
    let neg = [
        "not online",
        "no online",
        "offline",
        "cancelled",
        "canceled",
    ]
    .iter()
    .any(|s| note.contains(s));
    if !neg
        && (note == "online"
            || note == "online class"
            || note.starts_with("online class via")
            || note.starts_with("online class -")
            || note.contains("class: online")
            || note.contains("lesson: online"))
    {
        "Online · source note".into()
    } else if campus::haze_active()
        && text(e, "date") >= today().as_str()
        && text(e, "date") <= "2026-10-25"
    {
        "Confirm class delivery".into()
    } else {
        String::new()
    }
}
fn card(e: &Value, s: &State) -> String {
    let subject = esc(text(e, "subject"));
    let id = esc(text(e, "id"));
    let mode = mode_reminder(e);
    let tone = text(e, "subject").chars().map(|c| c as u32).sum::<u32>() % 3;
    let mut output=format!("<button class=\"lesson {}\" data-event-id=\"{id}\" aria-label=\"{subject}, {} to {}, {}, {}, {}{}{}\"><span class=\"lesson-time\">{} – {}</span><h3>{subject}</h3>",if tone==1{"alt"}else if tone==2{"warm"}else{""},esc(text(e,"start")),esc(text(e,"end")),esc(text(e,"room")),esc(text(e,"date")),esc(if text(e,"className").is_empty(){text(&s.selected,"name")}else{text(e,"className")}),if e["overlap"]==true{" overlapping entry"}else{""},if text(e,"exception").is_empty(){""}else{" calendar exception"},text(e,"start"),text(e,"end"));
    if !mode.is_empty() {
        output += &format!("<span class=\"badge mode-badge\">{}</span>", esc(&mode));
    }
    if s.mode == "lecturer" {
        output += &format!(
            "<span class=\"lesson-meta\">{}</span>",
            esc(text(e, "className"))
        );
    }
    output += &format!(
        "<span class=\"lesson-meta\">{}</span><span class=\"lesson-meta\">{}</span>",
        if text(e, "room").is_empty() {
            "Room not listed".into()
        } else {
            esc(text(e, "room"))
        },
        esc(text(e, "lecturer"))
    );
    if !text(e, "note").is_empty() {
        output += &format!("<p class=\"lesson-note\">{}</p>", esc(text(e, "note")));
    }
    for (key, label) in [
        ("exception", "Calendar exception"),
        ("overlap", "Overlapping entry"),
    ] {
        if (e[key].is_string() && !text(e, key).is_empty()) || e[key] == true {
            output += &format!("<span class=\"badge amber\">{label}</span>");
        }
    }
    output + "</button>"
}
fn render() {
    campus::render_haze();
    let focused = doc()
        .active_element()
        .and_then(|e| e.get_attribute("data-day"));
    read(|s| {
        let ready = !s.manifest.is_null();
        let selected = !s.selected.is_null();
        let usable = selected && !s.loading && s.error.is_empty();
        for (q, mode) in [("#student-mode", "class"), ("#lecturer-mode", "lecturer")] {
            attr(
                q,
                "aria-pressed",
                if s.mode == mode { "true" } else { "false" },
            );
            disabled(q, !ready);
        }
        disabled("#dav-export", s.bytes.is_empty());
        txt(
            "#dav-hint",
            if s.bytes.is_empty() {
                "To edit and export a DAV, open your original file. Downloads preserve the full timetable."
            } else {
                "Local edits affect recurring lessons. Export DAV saves the full file; verify it in DaVinci."
            },
        );
        let name = text(&s.selected, "name");
        txt(
            "#class-name",
            if selected {
                name
            } else {
                "Let’s get you started"
            },
        );
        txt(
            "#compact-class-name",
            if selected {
                name
            } else if s.mode == "lecturer" {
                "Choose a lecturer"
            } else {
                "Choose your class"
            },
        );
        txt("#mobile-class-name", name);
        txt(
            ".mobile-export small",
            if s.mode == "lecturer" {
                "LECTURER CALENDAR"
            } else {
                "YOUR CLASS CALENDAR"
            },
        );
        txt(
            "#class-button small",
            if s.mode == "lecturer" {
                "Lecturer timetable"
            } else if selected {
                "Your timetable"
            } else {
                "Choose your class"
            },
        );
        disabled("#class-button", !ready);
        disabled("#compact-class-button", !ready);
        disabled("#share-button", !usable || s.local);
        attr("#share-button", "aria-label", "Share week");
        txt(
            "#file-source-label",
            &if s.local {
                format!("On this device: {}", text(&s.manifest, "filename"))
            } else if s.manifest["communityUpload"] == true {
                "Community-uploaded timetable · not verified by GMI".into()
            } else {
                "Using the provided timetable".into()
            },
        );
        hidden("#restore-source", !s.local);
        hidden("#latest-timetable", !ready);
        if ready {
            let label = if s.local {
                "Local file loaded".into()
            } else {
                format!(
                    "{} · {}",
                    text(&s.manifest, "revisionCode"),
                    fmt(text(&s.manifest, "sourceRevisionDate"), "%-d %b %Y")
                )
            };
            txt("#latest-timetable-label", &label);
            let unread =
                !s.local && stored("timetable-seen-revision") != text(&s.manifest, "sourceHash");
            hidden("#revision-new-dot", !unread);
            attr(
                "#latest-timetable",
                "aria-label",
                &format!(
                    "{}{label}. View timetable source details",
                    if unread { "New timetable loaded. " } else { "" }
                ),
            );
            txt("#about-source-description",&format!("{}: {}. Revision {}. Planning range: {} through {}. Calendar downloads are snapshots; confirm changes with your lecturer.",if s.local{"You’re viewing a local file"}else if s.manifest["communityUpload"]==true{"Community-uploaded timetable (not verified by GMI)"}else{"Latest provided timetable"},if s.local{text(&s.manifest,"filename")}else{text(&s.manifest,"sourceFilename")},text(&s.manifest,"sourceRevision"),text(&s.manifest,"planningStart"),text(&s.manifest,"planningEnd")));
        }
        txt(
            "#revision",
            &format!(
                "Source revision · {}",
                if s.local {
                    "your local file"
                } else {
                    text(&s.manifest, "sourceRevision")
                }
            ),
        );
        for b in all(".export-trigger") {
            if !usable || s.selected["eventCount"].as_u64().unwrap_or(0) == 0 {
                let _ = b.set_attribute("disabled", "");
            } else {
                let _ = b.remove_attribute("disabled");
            }
        }
        hidden(".mobile-export", !selected);
        for q in ["#summary", "#subbar", "#day-strip"] {
            hidden(q, !usable);
        }
        txt(
            "#week-label",
            &if ready {
                weeklabel(&s.week)
            } else {
                "Loading schedule…".into()
            },
        );
        setval("#week-date", &s.week);
        disabled("#week-date", !ready);
        if ready {
            attr("#week-date", "min", text(&s.manifest, "planningStart"));
            attr("#week-date", "max", text(&s.manifest, "planningEnd"));
            disabled(
                "#previous-week",
                s.week <= monday(text(&s.manifest, "planningStart")),
            );
            disabled(
                "#next-week",
                s.week >= monday(text(&s.manifest, "planningEnd")),
            );
            disabled("#today-button", false);
        }
        for (q, view) in [("#week-view", "week"), ("#agenda-view", "agenda")] {
            let _ = el(q)
                .class_list()
                .toggle_with_force("active", s.view == view);
            attr(
                q,
                "aria-pressed",
                if s.view == view { "true" } else { "false" },
            );
        }
        attr(
            "#schedule",
            "aria-busy",
            if s.loading || !ready { "true" } else { "false" },
        );
        txt(
            "#greeting",
            if s.mode == "lecturer" {
                "LECTURER TIMETABLE · ALL CLASSES"
            } else if selected {
                "YOUR CLASS. YOUR SCHEDULE."
            } else {
                "YOUR STUDENT PLANNER"
            },
        );
        txt(
            "#heading-description",
            &if selected {
                format!("{name} · Times in Kuala Lumpur")
            } else {
                "Less searching. More time for what’s next.".into()
            },
        );
        if !s.error.is_empty() {
            attr("#schedule", "aria-busy", "false");
            html(
                "#schedule",
                &panel("Let’s try that again", &s.error, "retry", "Retry"),
            );
            return;
        }
        if s.loading || !ready {
            html(
                "#schedule",
                &panel(
                    "Getting your planner ready",
                    "Loading the available classes…",
                    "",
                    "",
                ),
            );
            return;
        }
        if !selected {
            html(
                "#schedule",
                &panel(
                    "Your timetable starts here",
                    "Choose your class or lecturer to see the schedule and export its calendar.",
                    "choose-class",
                    if s.mode == "lecturer" {
                        "Find a lecturer"
                    } else {
                        "Find my class"
                    },
                ),
            );
            return;
        }
        let all_week = filtered(&s.events, &s.week, "");
        let events = filtered(&s.events, &s.week, &s.query);
        let hours = all_week
            .iter()
            .map(|e| minutes(text(e, "end")) - minutes(text(e, "start")))
            .sum::<i64>() as f64
            / 60.;
        let rooms = all_week
            .iter()
            .map(|e| text(e, "room"))
            .filter(|s| !s.is_empty())
            .collect::<BTreeSet<_>>()
            .len();
        html("#summary",&[(all_week.len().to_string(),"lessons this week"),(format!("{hours:.1}").trim_end_matches(".0").to_string(),"scheduled hours"),(rooms.to_string(),"rooms this week")].iter().map(|(v,label)|format!("<div class=\"summary-item\"><span class=\"summary-icon\" aria-hidden=\"true\">◷</span><div><strong>{v}</strong><small>{label}</small></div></div>")).collect::<String>());
        html("#day-strip",&(0..7).map(|i|{let d=add_days(&s.week,i);format!("<button class=\"day-tab {} {}\" data-day=\"{d}\" aria-label=\"{}\" aria-pressed=\"{}\"><span>{}</span><strong>{}</strong><span class=\"day-marker\" style=\"{}\"></span></button>",if d==s.day{"active"}else{""},if d==today(){"today"}else{""},fmt(&d,"%A %-d %B"),d==s.day,fmt(&d,"%a"),fmt(&d,"%-d"),if events.iter().any(|e|text(e,"date")==d){""}else{"visibility:hidden"})}).collect::<String>());
        txt(
            "#schedule-context",
            &format!(
                "{} entries · {}{}",
                events.len(),
                weeklabel(&s.week),
                if s.query.is_empty() {
                    " on your schedule"
                } else {
                    " matching your search"
                }
            ),
        );
        if events.is_empty() && !mobile() {
            let next = s
                .events
                .iter()
                .find(|e| text(e, "date") > add_days(&s.week, 6).as_str());
            html(
                "#schedule",
                &panel(
                    if s.query.is_empty() {
                        "No classes listed this week"
                    } else {
                        "Nothing matches that search"
                    },
                    if s.query.is_empty() {
                        "No dated class entries are listed for this week. Choose another week or download the complete calendar."
                    } else {
                        "Try a different subject, room or lecturer."
                    },
                    if !s.query.is_empty() {
                        "clear-search"
                    } else if next.is_some() {
                        "next-scheduled"
                    } else {
                        "choose-class"
                    },
                    if !s.query.is_empty() {
                        "Clear search"
                    } else if next.is_some() {
                        "Go to next class"
                    } else {
                        "Choose another class"
                    },
                ),
            );
            return;
        }
        let agenda = mobile() || s.view == "agenda";
        let dates = if mobile() {
            vec![s.day.clone()]
        } else {
            (0..7).map(|i| add_days(&s.week, i)).collect()
        };
        let mut output = format!(
            "<div class=\"{}\">",
            if agenda { "agenda-list" } else { "week-grid" }
        );
        for (i, d) in dates.iter().enumerate() {
            let lessons = events
                .iter()
                .filter(|e| text(e, "date") == d)
                .collect::<Vec<_>>();
            let exceptions = s.manifest["exceptions"]
                .as_array()
                .map(|a| {
                    a.iter()
                        .filter(|e| text(e, "date") == d)
                        .map(|e| text(e, "name"))
                        .collect::<BTreeSet<_>>()
                })
                .unwrap_or_default();
            if agenda && !mobile() && lessons.is_empty() && exceptions.is_empty() {
                continue;
            }
            if agenda {
                output+=&format!("<section class=\"agenda-day\"><div class=\"agenda-day-heading\"><h2>{}<span>{}</span></h2>{}</div>",fmt(d,"%A"),fmt(d,"%-d %B"),if *d==today(){"<span class=\"badge\">Today</span>"}else{""});
            } else {
                output+=&format!("<section class=\"day-column {}\" aria-label=\"{}\"><h2 class=\"day-heading {}\"><span>{}</span><strong>{}</strong></h2>",if i>4{"weekend"}else{""},fmt(d,"%A %-d %B"),if *d==today(){"current"}else{""},fmt(d,"%a").to_uppercase(),fmt(d,"%-d"));
            }
            for ex in exceptions {
                output += &format!("<span class=\"day-exception\">{}</span>", esc(ex));
            }
            if agenda {
                output += "<div class=\"agenda-events\">";
            }
            if lessons.is_empty() {
                output += &if agenda {
                    panel(
                        if s.query.is_empty() {
                            "A little breathing room"
                        } else {
                            "No matching lessons"
                        },
                        "No class entries are listed for this day. Choose another day above.",
                        "",
                        "",
                    )
                } else {
                    "<p class=\"no-day\"><span></span>No classes</p>".into()
                };
            } else {
                for e in lessons {
                    output += &card(e, s);
                }
            }
            if agenda {
                output += "</div>";
            }
            output += "</section>";
        }
        output += "</div>";
        html("#schedule", &output);
    });
    if let Some(d) = focused {
        focus(&format!("[data-day=\"{d}\"]"));
    }
}
fn lesson(id: &str) {
    let pair = read(|s| {
        s.events
            .iter()
            .find(|e| text(e, "id") == id)
            .map(|e| (e.clone(), s.selected.clone(), !s.bytes.is_empty()))
    });
    let Some((e, selected, editable)) = pair else {
        return;
    };
    let mut output=format!("<p class=\"lesson-title-date\">{}</p><h2 id=\"lesson-dialog-title\">{}</h2><p class=\"lesson-class\">{}</p>",fmt(text(&e,"date"),"%A %-d %B %Y"),esc(text(&e,"subject")),esc(if text(&e,"className").is_empty(){text(&selected,"name")}else{text(&e,"className")}));
    for (label, value) in [
        (
            "TIME · KUALA LUMPUR",
            format!("{} – {}", text(&e, "start"), text(&e, "end")),
        ),
        ("ROOM", text(&e, "room").into()),
        ("LECTURER", text(&e, "lecturer").into()),
        ("NOTES", text(&e, "note").into()),
    ] {
        output += &format!(
            "<div class=\"detail-row\"><div><small>{label}</small><strong>{}</strong></div></div>",
            esc(&value)
        );
    }
    if !mode_reminder(&e).is_empty() {
        output += &format!(
            "<div class=\"lesson-mode-notice\"><strong>Class delivery</strong><p>{}</p></div>",
            if mode_reminder(&e).starts_with("Online") {
                "The timetable note says online. Confirm the latest arrangements and meeting link with your lecturer."
            } else {
                "This lesson is not confirmed online. Check your lecturer’s latest message or GMI announcements before travelling."
            }
        );
    }
    if !text(&e, "exception").is_empty() {
        output += &format!(
            "<span class=\"badge amber\">{} — calendar exception</span>",
            esc(text(&e, "exception"))
        );
    }
    if e["overlap"] == true {
        output+="<span class=\"badge amber\">Overlaps another class entry. Check with your lecturer.</span>";
    }
    if editable {
        output += &format!(
            "<button class=\"button secondary\" data-edit-id=\"{}\">Edit recurring lesson</button>",
            esc(id)
        );
    }
    html("#lesson-content", &output);
    open("#lesson-dialog");
}
fn blob_url(bytes: &[u8], mime: &str) -> String {
    let parts = js_sys::Array::new();
    parts.push(&js_sys::Uint8Array::from(bytes));
    let options = BlobPropertyBag::new();
    options.set_type(mime);
    Url::create_object_url_with_blob(
        &Blob::new_with_u8_array_sequence_and_options(&parts, &options).unwrap(),
    )
    .unwrap()
}
fn download(bytes: &[u8], name: &str, mime: &str) {
    let url = blob_url(bytes, mime);
    let a = doc()
        .create_element("a")
        .unwrap()
        .dyn_into::<HtmlAnchorElement>()
        .unwrap();
    a.set_href(&url);
    a.set_download(name);
    a.click();
    let f = Closure::once_into_js(move || {
        let _ = Url::revoke_object_url(&url);
    });
    let _ = win().set_timeout_with_callback_and_timeout_and_arguments_0(f.unchecked_ref(), 1000);
}
fn export() {
    let data = read(|s| {
        if s.selected.is_null() || s.loading || s.events.is_empty() {
            None
        } else {
            Some((
                s.selected.clone(),
                s.events.clone(),
                s.mode.clone(),
                s.local || s.manifest["communityUpload"] == true,
            ))
        }
    });
    let Some((selected, events, mode, dynamic)) = data else {
        return;
    };
    let stamp = js_sys::Date::new_0()
        .to_iso_string()
        .as_string()
        .unwrap()
        .replace(['-', ':'], "");
    let stamp = stamp.split('.').next().unwrap().to_string() + "Z";
    let path = if dynamic || mode == "lecturer" {
        let bytes = calendar(&selected, &events, &stamp);
        let url = blob_url(bytes.as_bytes(), "text/calendar;charset=utf-8");
        update(|s| {
            if !s.blob.is_empty() {
                let _ = Url::revoke_object_url(&s.blob);
            }
            s.blob = url.clone();
        });
        url
    } else {
        format!("./calendars/{}.ics", text(&selected, "id"))
    };
    html("#export-content",&format!("<p class=\"dialog-description\">Keep your class timetable in the calendar app you already use.</p><div class=\"export-class\"><strong>{}</strong><p>{} entries</p></div><a id=\"calendar-download\" class=\"button primary full download-link\" href=\"{}\" download=\"GMI-{}.ics\">Download {} calendar (.ics)</a><p class=\"export-notice\">Only the selected {} timetable is included. Times use Kuala Lumpur (UTC+8); entries are tentative.</p><details open><summary>Google Calendar</summary><p>Settings → Import &amp; export → select this .ics file and your destination calendar.</p></details><details><summary>Apple Calendar</summary><p>File → Import → select this .ics file.</p></details><details><summary>Outlook</summary><p>Add calendar → Upload from file → select this .ics file.</p></details><p class=\"export-footnote\">This download is a snapshot; it won’t update automatically. Import into a separate class calendar to avoid duplicates.</p>",esc(text(&selected,"name")),events.len(),esc(&path),esc(text(&selected,"id")),if mode=="lecturer"{"lecturer"}else{"my class"},if mode=="lecturer"{"lecturer"}else{"class"}));
    open("#export-dialog");
}
async fn share() {
    let url = win().location().href().unwrap();
    match JsFuture::from(win().navigator().clipboard().write_text(&url)).await {
        Ok(_) => toast("Class and week link copied."),
        Err(_) => {
            html("#lesson-content",&format!("<h2 id=\"lesson-dialog-title\">Share this week</h2><label class=\"search-field\"><input id=\"share-link\" aria-label=\"Class and week link\" value=\"{}\" readonly></label>",esc(&url)));
            open("#lesson-dialog");
        }
    }
}
fn apply_preferences() {
    for id in ["large-text", "high-contrast", "reduce-motion"] {
        let _ = el("html")
            .class_list()
            .toggle_with_force(id, checked(&format!("#{id}")));
    }
}
fn theme() {
    let choice = stored("timetable-theme");
    let dark = choice == "dark"
        || (choice != "light"
            && win()
                .match_media("(prefers-color-scheme: dark)")
                .unwrap()
                .unwrap()
                .matches());
    attr("html", "data-theme", if dark { "dark" } else { "light" });
    setval(
        "#theme-mode",
        if choice.is_empty() { "system" } else { &choice },
    );
    txt(
        "#theme-toggle",
        if dark { "Light mode" } else { "Dark mode" },
    );
    attr(
        "#theme-toggle",
        "aria-label",
        if dark {
            "Switch to light theme"
        } else {
            "Switch to dark theme"
        },
    );
}
fn install_local(mut result: Value, bytes: Vec<u8>) {
    let mut cache = HashMap::new();
    if let Some(datasets) = result["datasets"].as_object() {
        for (id, d) in datasets {
            cache.insert(format!("class/{id}"), d.clone());
        }
    }
    let all = result["lecturerEvents"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    if let Some(lecturers) = result["manifest"]["lecturers"].as_array_mut() {
        for item in lecturers {
            let mut events = all
                .iter()
                .filter(|e| text(e, "lecturer") == text(item, "name"))
                .cloned()
                .collect::<Vec<_>>();
            events.sort_by(|a, b| {
                text(a, "date")
                    .cmp(text(b, "date"))
                    .then(text(a, "start").cmp(text(b, "start")))
            });
            timetable_core::mark_overlaps(&mut events);
            item["eventCount"] = json!(events.len());
            item["firstDate"] = events
                .first()
                .map(|e| json!(text(e, "date")))
                .unwrap_or(Value::Null);
            item["lastDate"] = events
                .last()
                .map(|e| json!(text(e, "date")))
                .unwrap_or(Value::Null);
            cache.insert(
                format!("lecturer/{}", text(item, "id")),
                json!({"class":item,"events":events}),
            );
        }
    }
    update(|s| {
        s.manifest = result["manifest"].take();
        s.editor = result["editor"].take();
        s.bytes = bytes;
        s.local = true;
        s.cache = cache;
        s.selected = Value::Null;
        s.events.clear();
        s.loading = false;
        s.error.clear();
        s.query.clear();
        s.request += 1;
        s.week = clamp_week(
            &today(),
            text(&s.manifest, "planningStart"),
            text(&s.manifest, "planningEnd"),
        );
        s.day = s.week.clone();
    });
    setval("#subject-search", "");
    update_url();
    render();
}
async fn import_file() {
    let file = el("#file-input")
        .dyn_into::<HtmlInputElement>()
        .unwrap()
        .files()
        .and_then(|f| f.get(0));
    let Some(file) = file else { return };
    hidden("#file-error", true);
    hidden("#file-progress", false);
    txt(
        "#file-progress",
        &format!("Reading {} on your device…", file.name()),
    );
    disabled("#file-input", true);
    let seq = read(|s| s.import) + 1;
    update(|s| s.import = seq);
    if file.size() > 20. * 1024. * 1024. {
        txt("#file-error", "Choose a timetable file smaller than 20 MB.");
        hidden("#file-error", false);
        hidden("#file-progress", true);
        disabled("#file-input", false);
        return;
    }
    let bytes = match JsFuture::from(file.array_buffer()).await {
        Ok(buffer) => js_sys::Uint8Array::new(&buffer).to_vec(),
        Err(_) => {
            txt("#file-error", "Could not read this file.");
            hidden("#file-error", false);
            disabled("#file-input", false);
            return;
        }
    };
    if seq != read(|s| s.import) {
        return;
    }
    let options = WorkerOptions::new();
    options.set_type(WorkerType::Module);
    let worker = match Worker::new_with_options("./file-worker.js", &options) {
        Ok(w) => w,
        Err(_) => {
            txt(
                "#file-error",
                "The timetable reader could not start. Refresh and retry.",
            );
            hidden("#file-error", false);
            disabled("#file-input", false);
            return;
        }
    };
    update(|s| {
        if let Some(w) = s.worker.take() {
            w.terminate();
        }
        s.worker = Some(worker.clone());
    });
    let filename = file.name();
    let saved = bytes.clone();
    let handler = Closure::<dyn FnMut(MessageEvent)>::new(move |e: MessageEvent| {
        if seq != read(|s| s.import) {
            return;
        }
        let value: Value = serde_wasm_bindgen::from_value(e.data()).unwrap_or(Value::Null);
        if value["ok"] == true {
            let mut result = value["result"].clone();
            result["manifest"]["filename"] = json!(filename);
            install_local(result, saved.clone());
            close("#file-dialog");
            picker();
            toast("Timetable loaded from your file. Your file stays on this device.");
        } else {
            txt("#file-error", text(&value, "error"));
            hidden("#file-error", false);
        }
        disabled("#file-input", false);
        hidden("#file-progress", true);
        update(|s| {
            if let Some(w) = s.worker.take() {
                w.terminate();
            }
        });
    });
    worker.set_onmessage(Some(handler.as_ref().unchecked_ref()));
    handler.forget();
    let message = js_sys::Object::new();
    let array = js_sys::Uint8Array::from(bytes.as_slice());
    let _ = js_sys::Reflect::set(&message, &"buffer".into(), &array.buffer());
    let _ = js_sys::Reflect::set(&message, &"filename".into(), &file.name().into());
    let _ = worker.post_message(&message);
    let timeout = Closure::once_into_js(move || {
        if seq == read(|s| s.import) && read(|s| s.worker.is_some()) {
            update(|s| {
                if let Some(w) = s.worker.take() {
                    w.terminate();
                }
            });
            txt(
                "#file-error",
                "This file took too long to decode. Try a smaller compatible DAV.",
            );
            hidden("#file-error", false);
            hidden("#file-progress", true);
            disabled("#file-input", false);
        }
    });
    let _ =
        win().set_timeout_with_callback_and_timeout_and_arguments_0(timeout.unchecked_ref(), 20000);
}
#[wasm_bindgen(raw_module = "../engine-bridge.js")]
extern "C" {
    #[wasm_bindgen(catch)]
    async fn edit_source(
        bytes: js_sys::Uint8Array,
        id: &str,
        note: &str,
        day: u8,
        period: u8,
    ) -> Result<JsValue, JsValue>;
}
fn edit_lesson(id: &str) {
    let record = read(|s| s.editor["events"][id].clone());
    if record.is_null() {
        return;
    }
    update(|s| s.edit_id = id.into());
    setval("#edit-note", text(&record, "note"));
    html(
        "#edit-day",
        &[
            "Monday",
            "Tuesday",
            "Wednesday",
            "Thursday",
            "Friday",
            "Saturday",
            "Sunday",
        ]
        .iter()
        .enumerate()
        .map(|(i, d)| format!("<option value=\"{}\">{d}</option>", i + 1))
        .collect::<String>(),
    );
    setval("#edit-day", &record["slots"][0]["day"].to_string());
    let periods = read(|s| s.editor["periods"].as_array().cloned().unwrap_or_default());
    html(
        "#edit-period",
        &periods
            .iter()
            .enumerate()
            .map(|(i, n)| {
                format!(
                    "<option value=\"{}\">{:02}:{:02} (period {})</option>",
                    i + 1,
                    n.as_u64().unwrap_or(0) / 60,
                    n.as_u64().unwrap_or(0) % 60,
                    i + 1
                )
            })
            .collect::<String>(),
    );
    setval("#edit-period", &record["slots"][0]["period"].to_string());
    hidden("#edit-error", true);
    open("#edit-dialog");
}
async fn save_edit() {
    disabled("#save-edit", true);
    hidden("#edit-error", true);
    let (bytes, id, selected, week, filename) = read(|s| {
        (
            s.bytes.clone(),
            s.edit_id.clone(),
            text(&s.selected, "id").to_string(),
            s.week.clone(),
            text(&s.manifest, "filename").to_string(),
        )
    });
    let result = edit_source(
        js_sys::Uint8Array::from(bytes.as_slice()),
        &id,
        &val("#edit-note"),
        val("#edit-day").parse().unwrap_or(0),
        val("#edit-period").parse().unwrap_or(0),
    )
    .await;
    match result {
        Ok(v) => {
            let bytes =
                js_sys::Uint8Array::new(&js_sys::Reflect::get(&v, &"bytes".into()).unwrap())
                    .to_vec();
            let mut data: Value = serde_json::from_str(
                &js_sys::Reflect::get(&v, &"decoded".into())
                    .unwrap()
                    .as_string()
                    .unwrap(),
            )
            .unwrap();
            data["manifest"]["filename"] = json!(filename);
            install_local(data, bytes);
            close("#edit-dialog");
            close("#lesson-dialog");
            select(&selected, true).await;
            set_week(&week);
            focus("#main");
            toast("Recurring lesson updated locally. Export DAV to save your changes.");
        }
        Err(e) => {
            txt(
                "#edit-error",
                &e.as_string()
                    .unwrap_or("This edit could not be applied.".into()),
            );
            hidden("#edit-error", false);
        }
    }
    disabled("#save-edit", false);
}
async fn click(target: Element) {
    if let Ok(Some(button)) = target.closest(".close-dialog") {
        if let Ok(Some(d)) = button.closest("dialog") {
            if d.id() == "file-dialog" {
                update(|s| {
                    s.import += 1;
                    if let Some(w) = s.worker.take() {
                        w.terminate();
                    }
                });
                disabled("#file-input", false);
            }
            d.dyn_into::<HtmlDialogElement>().unwrap().close();
        }
        return;
    }
    for (key, action) in [
        ("data-class-id", 0),
        ("data-day", 1),
        ("data-event-id", 2),
        ("data-edit-id", 3),
        ("data-action", 4),
    ] {
        if let Ok(Some(node)) = target.closest(&format!("[{key}]")) {
            let value = node.get_attribute(key).unwrap();
            match action {
                0 => select(&value, false).await,
                1 => {
                    update(|s| s.day = value.clone());
                    render();
                    focus(&format!("[data-day=\"{value}\"]"));
                }
                2 => lesson(&value),
                3 => edit_lesson(&value),
                _ => match value.as_str() {
                    "choose-class" => picker(),
                    "retry" => {
                        let id = read(|s| text(&s.selected, "id").to_string());
                        if id.is_empty() {
                            initialize().await
                        } else {
                            select(&id, true).await
                        }
                    }
                    "clear-search" => {
                        update(|s| s.query.clear());
                        setval("#subject-search", "");
                        render();
                        focus("#subject-search");
                    }
                    "next-scheduled" => {
                        let next = read(|s| {
                            s.events
                                .iter()
                                .find(|e| text(e, "date") > add_days(&s.week, 6).as_str())
                                .map(|e| text(e, "date").to_string())
                        });
                        if let Some(d) = next {
                            set_week(&d);
                        }
                    }
                    _ => {}
                },
            }
            return;
        }
    }
    if target.closest(".export-trigger").ok().flatten().is_some() {
        export();
        return;
    }
    let id = target
        .closest("button")
        .ok()
        .flatten()
        .map(|e| e.id())
        .unwrap_or_else(|| target.id());
    match id.as_str() {
        "class-button" | "compact-class-button" => picker(),
        "student-mode" | "lecturer-mode" => {
            update(|s| {
                s.mode = if id == "student-mode" {
                    "class"
                } else {
                    "lecturer"
                }
                .into();
                s.selected = Value::Null;
                s.events.clear();
                s.error.clear();
                s.loading = false;
                s.request += 1;
            });
            render();
            picker();
        }
        "clear-class-filters" => {
            for q in [
                "#class-search",
                "#programme-filter",
                "#semester-filter",
                "#group-filter",
            ] {
                setval(q, "");
            }
            class_results();
        }
        "previous-week" => set_week(&read(|s| add_days(&s.week, -7))),
        "next-week" => set_week(&read(|s| add_days(&s.week, 7))),
        "today-button" => set_week(&today()),
        "week-view" | "agenda-view" => {
            update(|s| s.view = if id == "week-view" { "week" } else { "agenda" }.into());
            render();
        }
        "share-button" => share().await,
        "open-file-button" => {
            setval("#file-input", "");
            hidden("#file-error", true);
            hidden("#file-progress", true);
            open("#file-dialog");
        }
        "restore-source" => {
            initialize().await;
            toast("The provided timetable is active again.");
        }
        "accessibility-button" => open("#accessibility-dialog"),
        "quality-button" | "about-button" | "latest-timetable" => {
            if id == "latest-timetable" && read(|s| !s.local) {
                save(
                    "timetable-seen-revision",
                    &read(|s| text(&s.manifest, "sourceHash").to_string()),
                );
                hidden("#revision-new-dot", true);
            }
            open("#about-dialog");
        }
        "theme-toggle" => {
            save(
                "timetable-theme",
                if el("html").get_attribute("data-theme").as_deref() == Some("dark") {
                    "light"
                } else {
                    "dark"
                },
            );
            theme();
        }
        "dav-export" => {
            let (bytes, name) = read(|s| {
                (
                    s.bytes.clone(),
                    format!("edited-{}", text(&s.manifest, "filename")),
                )
            });
            if !bytes.is_empty() {
                download(&bytes, &name, "application/octet-stream");
                toast("DAV downloaded. Verify this experimental export in DaVinci before distributing.");
            }
        }
        "haze-toggle" => {
            let collapsed = stored("kajang-haze-2026-10-18-collapsed") != "true";
            save(
                "kajang-haze-2026-10-18-collapsed",
                if collapsed { "true" } else { "false" },
            );
            campus::render_haze();
        }
        "lift-button" => {
            open("#lifts-dialog");
            campus::load_lifts(false).await;
        }
        "lift-refresh" => campus::load_lifts(true).await,
        "publish-button" => open("#publish-dialog"),
        "air-refresh" => campus::load_air().await,
        "check-community" => {
            campus::check_community(true).await;
            toast("Timetable check complete. Confirm changes with your lecturer.");
        }
        _ => {}
    }
}
#[wasm_bindgen]
pub fn start() -> Result<(), JsValue> {
    for id in [
        "large-text",
        "high-contrast",
        "reduce-motion",
        "agenda-default",
    ] {
        let input = el(&format!("#{id}")).dyn_into::<HtmlInputElement>()?;
        input.set_checked(stored(&format!("timetable-{id}")) == "true");
    }
    apply_preferences();
    theme();
    if checked("#agenda-default") {
        update(|s| s.view = "agenda".into());
    }
    // Native event delegation keeps a single listener per event type and avoids per-render allocations.
    let on_click = Closure::<dyn FnMut(Event)>::new(|event: Event| {
        if let Some(target) = event.target().and_then(|t| t.dyn_into::<Element>().ok()) {
            spawn_local(click(target));
        }
    });
    doc().add_event_listener_with_callback("click", on_click.as_ref().unchecked_ref())?;
    on_click.forget();
    let input = Closure::<dyn FnMut(Event)>::new(|event: Event| {
        let Some(target) = event.target().and_then(|t| t.dyn_into::<Element>().ok()) else {
            return;
        };
        match target.id().as_str() {
            "class-search" => class_results(),
            "subject-search" => {
                update(|s| s.query = val("#subject-search"));
                render();
            }
            _ => {}
        }
    });
    doc().add_event_listener_with_callback("input", input.as_ref().unchecked_ref())?;
    input.forget();
    let change = Closure::<dyn FnMut(Event)>::new(|event: Event| {
        let Some(target) = event.target().and_then(|t| t.dyn_into::<Element>().ok()) else {
            return;
        };
        let id = target.id();
        match id.as_str() {
            "file-input" => spawn_local(import_file()),
            "week-date" => set_week(&val("#week-date")),
            "programme-filter" | "semester-filter" | "group-filter" => class_results(),
            "theme-mode" => {
                save("timetable-theme", &val("#theme-mode"));
                theme();
            }
            "air-station" => {
                save("timetable-air-station", &val("#air-station"));
                campus::render_air();
            }
            "large-text" | "high-contrast" | "reduce-motion" | "agenda-default" => {
                save(
                    &format!("timetable-{id}"),
                    if checked(&format!("#{id}")) {
                        "true"
                    } else {
                        "false"
                    },
                );
                apply_preferences();
                if id == "agenda-default" {
                    update(|s| {
                        s.view = if checked("#agenda-default") {
                            "agenda"
                        } else {
                            "week"
                        }
                        .into()
                    });
                }
                render();
            }
            _ => {}
        }
    });
    doc().add_event_listener_with_callback("change", change.as_ref().unchecked_ref())?;
    change.forget();
    let submit = Closure::<dyn FnMut(Event)>::new(|event: Event| {
        let Some(target) = event.target().and_then(|t| t.dyn_into::<Element>().ok()) else {
            return;
        };
        match target.id().as_str() {
            "edit-form" => {
                event.prevent_default();
                spawn_local(save_edit());
            }
            "lift-form" => {
                event.prevent_default();
                spawn_local(campus::submit_lift());
            }
            "publish-form" => {
                event.prevent_default();
                spawn_local(campus::publish());
            }
            _ => {}
        }
    });
    doc().add_event_listener_with_callback("submit", submit.as_ref().unchecked_ref())?;
    submit.forget();
    let resize = Closure::<dyn FnMut(Event)>::new(|_| render());
    win().add_event_listener_with_callback("resize", resize.as_ref().unchecked_ref())?;
    resize.forget();
    let changed = Closure::<dyn FnMut(Event)>::new(|_| theme());
    win()
        .match_media("(prefers-color-scheme: dark)")?
        .unwrap()
        .add_event_listener_with_callback("change", changed.as_ref().unchecked_ref())?;
    changed.forget();
    let close_file = Closure::<dyn FnMut(Event)>::new(|_| {
        update(|s| {
            s.import += 1;
            if let Some(w) = s.worker.take() {
                w.terminate();
            }
        });
        disabled("#file-input", false);
        hidden("#file-progress", true);
    });
    el("#file-dialog")
        .add_event_listener_with_callback("close", close_file.as_ref().unchecked_ref())?;
    close_file.forget();
    let tick = Closure::<dyn FnMut()>::new(campus::age_tick);
    let _ = win().set_interval_with_callback_and_timeout_and_arguments_0(
        tick.as_ref().unchecked_ref(),
        60000,
    );
    tick.forget();
    spawn_local(async {
        initialize().await;
        campus::check_community(false).await;
        campus::load_air().await;
    });
    Ok(())
}
