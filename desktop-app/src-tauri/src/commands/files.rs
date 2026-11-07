use super::shared::*;

pub(super) fn upload(f: &Value, key: &str, limit: usize) -> R<Option<(Vec<u8>, String)>> {
    let Some(v) = f.get(key) else { return Ok(None) };
    if v.is_null() || v.is_string() {
        return Ok(None);
    }
    let a = v
        .get("bytes")
        .and_then(Value::as_array)
        .ok_or("File bytes must be an array of integers.")?;
    if a.len() > limit {
        return Err(if key == "file" {
            "CSV must be at most 1 MB."
        } else {
            "Receipt must be no larger than 5 MB."
        }
        .into());
    }
    let bytes = a
        .iter()
        .map(|n| {
            n.as_u64()
                .filter(|n| *n <= 255)
                .map(|n| n as u8)
                .ok_or_else(|| "File bytes must be integers between 0 and 255.".to_string())
        })
        .collect::<R<Vec<_>>>()?;
    if bytes.is_empty() {
        return Ok(None);
    }
    let name = field(v, "name")
        .chars()
        .filter(|c| !c.is_control() && *c != '/' && *c != '\\')
        .take(200)
        .collect::<String>();
    Ok(Some((
        bytes,
        if name.is_empty() {
            "receipt".into()
        } else {
            name
        },
    )))
}
fn mime(b: &[u8], cover: bool) -> R<&'static str> {
    if b.starts_with(b"\x89PNG\r\n\x1a\n") {
        Ok("image/png")
    } else if b.starts_with(&[255, 216, 255]) {
        Ok("image/jpeg")
    } else if !cover && b.starts_with(b"%PDF-") {
        Ok("application/pdf")
    } else if cover && b.starts_with(b"RIFF") && b.get(8..12) == Some(b"WEBP".as_slice()) {
        Ok("image/webp")
    } else {
        Err(if cover {
            "Choose a PNG, JPEG, or WebP image."
        } else {
            "Only PDF, PNG, and JPEG receipts are supported."
        }
        .into())
    }
}
pub(super) fn receipt(c: &Connection, f: &Value, entry: &str) -> R<()> {
    let file = upload(f, "receipt", 5 * 1024 * 1024)?;
    let staged = if let Some((bytes, name)) = file {
        let m = mime(&bytes, false)?;
        Some((bytes, name, m))
    } else {
        None
    };
    if staged.is_some() || field(f, "remove_receipt") == "on" {
        exec(c, "DELETE FROM receipts WHERE entry_id=?", [entry])?;
    }
    if let Some((bytes, name, m)) = staged {
        let id = uid();
        exec(
            c,
            "INSERT INTO receipts(id,entry_id,filename,mime,size) VALUES (?,?,?,?,?)",
            params![id, entry, name, m, bytes.len() as i64],
        )?;
        exec(
            c,
            "INSERT INTO native_files(id,bytes) VALUES (?,?)",
            params![id, bytes],
        )?;
    }
    Ok(())
}
/// Receipt IDs are metadata IDs, cover IDs are the current cover version (or `1`).
/// No supplied identifier or filename is ever used as a filesystem path.
pub(super) fn read_asset(conn: &Connection, kind: &str, id: &str) -> R<Value> {
    let v = match kind {
        "receipt" => one(
            conn,
            "SELECT n.bytes,r.mime,r.filename FROM native_files n JOIN receipts r ON r.id=n.id WHERE r.id=?",
            [id],
        )?,
        "cover" => {
            let v = one(
                conn,
                "SELECT image bytes,mime FROM workspace_cover WHERE id=1 AND (version=?1 OR ?1='1')",
                [id],
            )?;
            if v.is_null() {
                v
            } else {
                let extension = match field(&v, "mime") {
                    "image/png" => "png",
                    "image/webp" => "webp",
                    _ => "jpg",
                };
                json!({"bytes":v["bytes"],"mime":v["mime"],"filename":format!("cover.{extension}")})
            }
        }
        _ => return Err("Unknown asset kind.".into()),
    };
    if v.is_null() {
        Err("Asset not found.".into())
    } else {
        Ok(v)
    }
}

/// Decode before taking the workspace lock: compressed size is not a safety bound.
pub(super) fn optimize_cover(bytes: &[u8]) -> R<(Vec<u8>, &'static str)> {
    use image::{ImageDecoder, ImageFormat, ImageReader};
    use std::io::Cursor;

    let format = image::guess_format(bytes).map_err(|_| "Choose a PNG, JPEG, or WebP image.")?;
    if !matches!(
        format,
        ImageFormat::Png | ImageFormat::Jpeg | ImageFormat::WebP
    ) {
        return Err("Choose a PNG, JPEG, or WebP image.".into());
    }
    let mut reader = ImageReader::with_format(Cursor::new(bytes), format);
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(32_768);
    limits.max_image_height = Some(32_768);
    limits.max_alloc = Some(512 * 1024 * 1024);
    reader.limits(limits);
    let decoder = reader
        .into_decoder()
        .map_err(|e| format!("Invalid cover image: {e}"))?;
    let (width, height) = decoder.dimensions();
    if width == 0 || height == 0 || u64::from(width) * u64::from(height) > 100_000_000 {
        return Err("Cover images must contain between 1 and 100 million pixels.".into());
    }
    let image = image::DynamicImage::from_decoder(decoder)
        .map_err(|e| format!("Invalid cover image: {e}"))?;
    let image = if width > 2560 || height > 1440 {
        image.resize(2560, 1440, image::imageops::FilterType::Lanczos3)
    } else {
        image
    };
    let mut output = Vec::new();
    let mime = if image.color().has_alpha() {
        image
            .write_to(&mut Cursor::new(&mut output), ImageFormat::Png)
            .map_err(|e| format!("Could not encode cover: {e}"))?;
        "image/png"
    } else {
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut output, 85)
            .encode_image(&image.to_rgb8())
            .map_err(|e| format!("Could not encode cover: {e}"))?;
        "image/jpeg"
    };
    Ok((output, mime))
}

#[cfg(test)]
pub(super) fn upload_cover_operation(c: &Connection, f: &Value) -> R<Value> {
    let (bytes, _) = upload(f, "cover", usize::MAX)?.ok_or("Choose an image.")?;
    let (bytes, mime) = optimize_cover(&bytes)?;
    store_cover(c, &bytes, mime)
}

fn store_cover(c: &Connection, b: &[u8], m: &str) -> R<Value> {
    exec(
        c,
        "INSERT INTO workspace_cover(id,version,mime,image,position) VALUES (1,?,?,?,50) ON CONFLICT(id) DO UPDATE SET version=excluded.version,mime=excluded.mime,image=excluded.image,position=50",
        params![uid(), m, b],
    )?;

    Ok(message("Cover updated."))
}

#[tauri::command]
pub async fn upload_cover(app: tauri::AppHandle, request: tauri::ipc::Request<'_>) -> R<Value> {
    use tauri::Manager;

    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => bytes.clone(),
        _ => return Err("Cover upload requires a raw binary body.".into()),
    };
    let mut connection = {
        let state = app.state::<std::sync::Mutex<crate::workspace::Workspace>>();
        let workspace = locked(&state)?;
        workspace.connection()?
    };
    tauri::async_runtime::spawn_blocking(move || {
        let (bytes, mime) = optimize_cover(&bytes)?;
        transaction(&mut connection, &json!({}), |c, _| {
            store_cover(c, &bytes, mime)
        })
    })
    .await
    .map_err(|e| format!("Cover processing failed: {e}"))?
}

pub(super) fn remove_cover_operation(c: &Connection, _f: &Value) -> R<Value> {
    exec(c, "DELETE FROM workspace_cover WHERE id=1", [])?;

    Ok(message("Cover updated."))
}

#[tauri::command]
pub fn remove_cover(state: NativeState<'_>, form: Value) -> R<Value> {
    let workspace = locked(&state)?;
    transaction(&mut workspace.connection()?, &form, remove_cover_operation)
}

pub(super) fn position_cover_operation(c: &Connection, f: &Value) -> R<Value> {
    let raw = field(f, "position");
    let p = raw
        .trim()
        .parse::<f64>()
        .map_err(|_| "Choose a cover position between 0 and 100.".to_string())?;
    if !p.is_finite() || !(0.0..=100.0).contains(&p) {
        return Err("Choose a cover position between 0 and 100.".into());
    }
    if exec(
        c,
        "UPDATE workspace_cover SET position=? WHERE id=1 AND version=?",
        params![p, field(f, "version")],
    )? == 0
    {
        return Err("The cover changed. Refresh and try again.".into());
    }

    Ok(message("Cover updated."))
}

#[tauri::command]
pub fn position_cover(state: NativeState<'_>, form: Value) -> R<Value> {
    let workspace = locked(&state)?;
    transaction(
        &mut workspace.connection()?,
        &form,
        position_cover_operation,
    )
}

#[tauri::command]
pub fn asset(state: NativeState<'_>, kind: String, id: String) -> R<Value> {
    let workspace = locked(&state)?;
    read_asset(&workspace.connection()?, &kind, &id)
}
