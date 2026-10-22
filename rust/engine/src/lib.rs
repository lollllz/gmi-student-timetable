use wasm_bindgen::prelude::*;
#[wasm_bindgen]
pub fn decode(bytes: &[u8], filename: &str) -> Result<String, JsValue> {
    let value = timetable_core::dav::decode(bytes, filename).map_err(|e| JsValue::from_str(&e))?;
    serde_json::to_string(&value).map_err(|e| JsValue::from_str(&e.to_string()))
}
#[wasm_bindgen]
pub fn edit(bytes: &[u8], id: &str, note: &str, day: u8, period: u8) -> Result<Vec<u8>, JsValue> {
    timetable_core::dav::edit(bytes, id, note, day, period).map_err(|e| JsValue::from_str(&e))
}

mod backend;
#[wasm_bindgen]
pub fn normalise_air(payload: &str, now: f64) -> Result<String, JsValue> {
    let payload = serde_json::from_str(payload)
        .map_err(|_| JsValue::from_str("Unexpected DOE station response"))?;
    let value = timetable_core::normalise_air(&payload, now).map_err(|e| JsValue::from_str(&e))?;
    Ok(value.to_string())
}
