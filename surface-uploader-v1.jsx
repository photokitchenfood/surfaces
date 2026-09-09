import { useState, useRef } from "react";

const COLOR_ORDER = ["ro", "gr", "ye", "pk", "br", "bl", "gy", "bk", "wh"];
const COLOR_META = {
  ro: { label: "Red / Orange", swatch: "#C1502E" },
  gr: { label: "Green", swatch: "#5B8C5A" },
  ye: { label: "Yellow", swatch: "#D9A62E" },
  pk: { label: "Pink / Purple", swatch: "#C88AA6" },
  br: { label: "Beige / Brown", swatch: "#8B6340" },
  bl: { label: "Blue", swatch: "#4A7A9D" },
  gy: { label: "Gray", swatch: "#9B958C" },
  bk: { label: "Black", swatch: "#2B2926" },
  wh: { label: "White", swatch: "#D8D3CB" }
};

const MATERIALS = [
  "Painted Panels", "Plastic Laminate", "Ceramic Tile", "Special Material",
  "Sticker & Printed", "Paper", "3D Elements", "Solid Wood"
];
const MATERIAL_PREFIX = {
  "Painted Panels": "pp", "Plastic Laminate": "pl", "Ceramic Tile": "ct",
  "Special Material": "sm", "Sticker & Printed": "sp", "Paper": "pa",
  "3D Elements": "3d", "Solid Wood": "sw"
};
const WET_SAFE_DEFAULT = {
  "Painted Panels": false, "Plastic Laminate": true, "Ceramic Tile": true,
  "Special Material": false, "Sticker & Printed": false, "Paper": false,
  "3D Elements": false, "Solid Wood": false
};
const SIZE_OPTIONS = ["Auto", "S", "M", "L", "XL"];

function computeAutoSize(length, width, diameter) {
  var dims = [];
  if (diameter) dims.push(diameter);
  if (length) dims.push(length);
  if (width) dims.push(width);
  if (!dims.length) return null;
  var longest = Math.max.apply(null, dims);
  if (longest < 40) return "S";
  if (longest < 70) return "M";
  if (longest < 100) return "L";
  return "XL";
}

function compressImage(file) {
  return new Promise(function(resolve, reject) {
    var reader = new FileReader();
    reader.onerror = function() { reject(new Error("Could not read file")); };
    reader.onload = function(e) {
      var img = new Image();
      img.onerror = function() { reject(new Error("Could not decode image")); };
      img.onload = function() {
        var canvas = document.createElement("canvas");
        var w = img.width, h = img.height;
        var maxWidth = 800;
        if (w > maxWidth) { h = Math.round(h * maxWidth / w); w = maxWidth; }
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.9));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

async function autoDescribe(b64) {
  var base64 = b64.split(",")[1];
  var prompt = "You are cataloging background surfaces and panels for a food photography studio. Look at this surface and respond with JSON only, no markdown, no explanation. Return exactly: {\"name\":\"[Color/Finish] [Descriptor] [Material Type]\",\"material\":\"[one material]\"} Materials: Painted Panels, Plastic Laminate, Ceramic Tile, Special Material, Sticker & Printed, Paper, 3D Elements, Solid Wood. Example: {\"name\":\"Dark Burgundy Textured Painted Panel\",\"material\":\"Painted Panels\"}";

  var res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "anthropic-dangerous-direct-browser-calls": "true"
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 200,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: base64 } },
          { type: "text", text: prompt }
        ]
      }]
    })
  });
  var text = await res.text();
  var data;
  try { data = JSON.parse(text); }
  catch(e) {
    var preview = text.slice(0, 120).replace(/\n/g, " ");
    throw new Error("API returned non-JSON response: " + preview);
  }
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  if (!data.content || !data.content[0]) throw new Error("Empty response from API");
  var raw = data.content[0].text ? data.content[0].text.trim() : "";
  raw = raw.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/, "").trim();
  try {
    var parsed = JSON.parse(raw);
    return {
      name: (parsed.name || "").replace(/^["']|["']$/g, ""),
      material: parsed.material || null
    };
  } catch(e) {
    return { name: raw.replace(/^["']|["']$/g, ""), material: null };
  }
}

function parseSurfaces(js) {
  try {
    var m = js.match(/window\._pkSurfaces\s*=\s*(\[[\s\S]*?\]);/);
    return m ? JSON.parse(m[1]) : [];
  } catch(e) { return []; }
}

function detectColorKey(js) {
  try {
    var arr = parseSurfaces(js);
    if (arr[0] && arr[0].id) {
      var key = arr[0].id.split("-")[0];
      return COLOR_ORDER.indexOf(key) !== -1 ? key : null;
    }
    return null;
  } catch(e) { return null; }
}

function getNextId(allSurfaces, colorKey, material) {
  var prefix = colorKey + "-" + (MATERIAL_PREFIX[material] || "xx") + "-";
  var nums = allSurfaces
    .filter(function(s) { return s.id && s.id.indexOf(prefix) === 0; })
    .map(function(s) { return parseInt(s.id.slice(prefix.length), 10); })
    .filter(function(n) { return !isNaN(n); });
  var next = nums.length ? Math.max.apply(null, nums) + 1 : 1;
  return prefix + next;
}

// Ensure the stored value is always a full data URL, since the catalog uses
// the _pkImages value directly as an <img> src.
function ensureDataUrl(photoStr) {
  if (!photoStr) return null;
  if (photoStr.startsWith("data:")) return photoStr;
  return "data:image/jpeg;base64," + photoStr;
}

// Builds a surface object with keys in the exact canonical field order, so
// JSON.stringify output stays interchangeable with the live site's
// downloadColorFile() serializer.
function buildSurfaceObject(v) {
  var obj = {};
  obj.id = v.id;
  obj.color = v.colorOverride || "";
  obj.material = v.material;
  if (v.size && v.size !== "Auto") obj.size = v.size;
  obj.name = v.name;
  obj.length = (v.length !== null && v.length !== undefined) ? v.length : null;
  obj.width = (v.width !== null && v.width !== undefined) ? v.width : null;
  obj.diameter = (v.diameter !== null && v.diameter !== undefined) ? v.diameter : null;
  if (v.qty && v.qty > 1) obj.qty = v.qty;
  if (v.storage && v.storage.trim()) obj.storage = v.storage.trim();
  obj.archived = !!v.archived;
  obj.planks = !!v.planks;
  if (v.planks && v.plankLength) obj.plank_length = v.plankLength;
  if (v.planks && v.plankWidth) obj.plank_width = v.plankWidth;
  obj.wet_safe = !!v.wetSafe;
  obj.has_small = !!v.hasSmall;
  if (v.hasSmall && v.smallLength) obj.small_length = v.smallLength;
  if (v.hasSmall && v.smallWidth) obj.small_width = v.smallWidth;
  if (v.notes && v.notes.trim()) obj.notes = v.notes.trim();
  return obj;
}

function mergeAndDownload(rawJs, queue, colorKey) {
  // 1. Parse existing surfaces array from raw JS
  var existingSurfaces = parseSurfaces(rawJs);

  // 2. Strip staged photos from queue objects (keys are already in canonical order)
  var newSurfaceObjs = queue.map(function(v) {
    var o = Object.assign({}, v);
    delete o._photo;
    return o;
  });

  // 3. Merge surfaces: existing + new
  var mergedSurfaces = existingSurfaces.concat(newSurfaceObjs);
  var mergedJson = JSON.stringify(mergedSurfaces, null, 2);

  // 4. Replace the window._pkSurfaces array in the raw JS, anchored on the
  //    structural boundary "];\n\nwindow._pkImages" to avoid greedy-match corruption.
  var start = rawJs.search(/window\._pkSurfaces\s*=\s*\[/);
  var anchor = rawJs.search(/\];\s*\n\s*\n\s*window\._pkImages\s*=/);
  var updatedJs;
  if (start !== -1 && anchor !== -1) {
    var end = rawJs.indexOf("];", anchor) + 2;
    updatedJs = rawJs.slice(0, start) + "window._pkSurfaces = " + mergedJson + ";" + rawJs.slice(end);
  } else {
    updatedJs = rawJs.replace(
      /window\._pkSurfaces\s*=\s*\[[\s\S]*?\];/,
      "window._pkSurfaces = " + mergedJson + ";"
    );
  }

  // 5. Merge new images into window._pkImages, keeping full data URLs.
  var newImageEntries = queue
    .filter(function(v) { return !!v._photo; })
    .map(function(v) {
      var dataUrl = ensureDataUrl(v._photo);
      return "  " + JSON.stringify(v.id) + ": " + JSON.stringify(dataUrl) + ",";
    })
    .join("\n");

  if (newImageEntries) {
    var imagesMatch = updatedJs.match(/window\._pkImages\s*=\s*\{/);
    if (imagesMatch) {
      var openIdx = updatedJs.indexOf("{", updatedJs.indexOf(imagesMatch[0]));
      var tail = updatedJs.slice(openIdx + 1);
      var closeMatch = tail.match(/\n(\s*)\}(\s*;?)/);
      if (closeMatch) {
        var nlPos = openIdx + 1 + tail.indexOf(closeMatch[0]);
        var closeIdx = nlPos + closeMatch[0].indexOf("}");
        var charBeforeClose = updatedJs.slice(0, nlPos).trimEnd().slice(-1);
        var needsComma = (charBeforeClose !== ",");
        var sep = needsComma ? ",\n" : "\n";
        updatedJs = updatedJs.slice(0, closeIdx) + sep + newImageEntries + "\n" + updatedJs.slice(closeIdx);
      }
    } else {
      updatedJs += "\n\nwindow._pkImages = {\n" + newImageEntries + "\n};";
    }
  }

  // 6. Download
  var blob = new Blob([updatedJs], { type: "text/javascript" });
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url;
  a.download = colorKey + ".js";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function AutoBadge(props) {
  return (
    <span style={{
      marginLeft: 7, fontSize: 8, letterSpacing: "0.1em",
      background: props.sw + "18", color: props.sw,
      border: "1px solid " + props.sw + "88",
      borderRadius: 3, padding: "1px 5px",
      textTransform: "uppercase", fontFamily: "DM Mono,monospace",
      verticalAlign: "middle", display: "inline-block"
    }}>auto</span>
  );
}

function Toggle(props) {
  return (
    <label style={{
      display: "flex", alignItems: "center", gap: 7, padding: "8px 10px",
      border: "1.5px solid " + (props.checked ? props.sw : "#DEDAD4"),
      background: props.checked ? props.sw + "18" : "#fff",
      borderRadius: 4, cursor: "pointer", fontSize: 11,
      color: props.checked ? props.sw : "#6B6860", fontFamily: "DM Mono,monospace"
    }}>
      <input type="checkbox" checked={props.checked} onChange={props.onChange} style={{ margin: 0 }} />
      {props.label}
    </label>
  );
}

var lbl = { display: "block", fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: "#6B6860", marginBottom: 5, fontFamily: "DM Mono,monospace" };
var inp = { width: "100%", boxSizing: "border-box", fontFamily: "DM Mono,monospace", fontSize: 12, padding: "8px 10px", border: "1.5px solid #DEDAD4", borderRadius: 4, background: "#F5F2EE", color: "#1A1A18", outline: "none" };
var card = { background: "#fff", borderRadius: 10, border: "1px solid #DEDAD4", padding: "20px 22px", marginBottom: 14 };

export default function SurfaceUploaderV1() {
  var [jsFileName, setJsFileName] = useState("");
  var [rawJs, setRawJs] = useState("");
  var [surfaces, setSurfaces] = useState([]);
  var [colorKey, setColorKey] = useState("ro");
  var [loaded, setLoaded] = useState(false);
  var [queue, setQueue] = useState([]);

  var [photo, setPhoto] = useState(null);
  var [name, setName] = useState("");
  var [nameAuto, setNameAuto] = useState(false);
  var [describing, setDescribing] = useState(false);
  var [material, setMaterial] = useState("Painted Panels");
  var [materialSuggested, setMaterialSuggested] = useState(false);

  var [length, setLength] = useState("");
  var [width, setWidth] = useState("");
  var [diameter, setDiameter] = useState("");
  var [sizeOverride, setSizeOverride] = useState("Auto");

  var [wetSafe, setWetSafe] = useState(WET_SAFE_DEFAULT["Painted Panels"]);
  var [wetSafeTouched, setWetSafeTouched] = useState(false);
  var [hasSmall, setHasSmall] = useState(false);
  var [smallLength, setSmallLength] = useState("");
  var [smallWidth, setSmallWidth] = useState("");
  var [planks, setPlanks] = useState(false);
  var [plankLength, setPlankLength] = useState("");
  var [plankWidth, setPlankWidth] = useState("");
  var [archived, setArchived] = useState(false);

  var [qty, setQty] = useState("1");
  var [storage, setStorage] = useState("");
  var [notes, setNotes] = useState("");

  var [jsDrag, setJsDrag] = useState(false);
  var [photoDrag, setPhotoDrag] = useState(false);
  var [nameErr, setNameErr] = useState(false);
  var [editingId, setEditingId] = useState(null);
  var [editFields, setEditFields] = useState({});
  var [downloaded, setDownloaded] = useState(false);
  var [apiError, setApiError] = useState("");

  var jsFileRef = useRef(null);
  var photoFileRef = useRef(null);

  var meta = COLOR_META[colorKey] || { label: colorKey, swatch: "#999" };
  var sw = meta.swatch;
  var isWhite = colorKey === "wh";
  var allSurfaces = surfaces.concat(queue);
  var nextId = loaded ? getNextId(allSurfaces, colorKey, material) : null;
  var canAdd = name.trim().length > 0 && !describing;
  var autoSizePreview = computeAutoSize(parseFloat(length) || null, parseFloat(width) || null, parseFloat(diameter) || null);

  function handleJsFile(file) {
    if (!file || !file.name.endsWith(".js")) return;
    var reader = new FileReader();
    reader.onload = function(e) {
      var text = e.target.result;
      var parsed = parseSurfaces(text);
      var det = detectColorKey(text);
      setJsFileName(file.name);
      setRawJs(text);
      setSurfaces(parsed);
      if (det) setColorKey(det);
      setQueue([]);
      setLoaded(true);
      setDownloaded(false);
    };
    reader.readAsText(file);
  }

  function applyMaterial(m) {
    setMaterial(m);
    if (!wetSafeTouched) setWetSafe(WET_SAFE_DEFAULT[m]);
  }

  async function handlePhoto(file) {
    if (!file || !file.type.startsWith("image/")) return;
    setPhoto(null);
    setDescribing(true);
    setName("");
    setNameAuto(false);
    setApiError("");
    try {
      var b64 = await compressImage(file);
      setPhoto(b64);
      var result = await autoDescribe(b64);
      setName(result.name);
      setNameAuto(true);
      if (result.material && MATERIALS.indexOf(result.material) !== -1) {
        applyMaterial(result.material);
        setMaterialSuggested(true);
      }
    } catch(e) {
      setName("");
      setApiError("Auto-describe failed: " + e.message + ". You can type a name manually.");
    }
    setDescribing(false);
  }

  function resetForm() {
    setPhoto(null); setName(""); setNameAuto(false);
    setLength(""); setWidth(""); setDiameter(""); setSizeOverride("Auto");
    setWetSafe(WET_SAFE_DEFAULT[material]); setWetSafeTouched(false);
    setHasSmall(false); setSmallLength(""); setSmallWidth("");
    setPlanks(false); setPlankLength(""); setPlankWidth("");
    setArchived(false);
    setQty("1"); setStorage(""); setNotes("");
    setMaterialSuggested(false); setApiError("");
    if (photoFileRef.current) photoFileRef.current.value = "";
  }

  function addSurface() {
    if (!name.trim()) {
      setNameErr(true);
      setTimeout(function() { setNameErr(false); }, 1500);
      return;
    }
    var id = getNextId(allSurfaces, colorKey, material);
    var v = buildSurfaceObject({
      id: id,
      material: material,
      size: sizeOverride,
      name: name.trim(),
      length: parseFloat(length) || null,
      width: parseFloat(width) || null,
      diameter: parseFloat(diameter) || null,
      qty: parseInt(qty, 10) || 1,
      storage: storage,
      archived: archived,
      planks: planks,
      plankLength: parseFloat(plankLength) || null,
      plankWidth: parseFloat(plankWidth) || null,
      wetSafe: wetSafe,
      hasSmall: hasSmall,
      smallLength: parseFloat(smallLength) || null,
      smallWidth: parseFloat(smallWidth) || null,
      notes: notes
    });
    v._photo = photo;
    setQueue(function(p) { return p.concat([v]); });
    var vNoPhoto = Object.assign({}, v); delete vNoPhoto._photo;
    setSurfaces(function(p) { return p.concat([vNoPhoto]); });
    resetForm();
    setDownloaded(false);
  }

  function removeFromQueue(id) {
    setQueue(function(p) { return p.filter(function(v) { return v.id !== id; }); });
    setSurfaces(function(p) { return p.filter(function(v) { return v.id !== id; }); });
    if (editingId === id) setEditingId(null);
    setDownloaded(false);
  }

  function startEdit(v) {
    setEditingId(v.id);
    setEditFields({
      name: v.name, material: v.material,
      length: v.length !== null && v.length !== undefined ? String(v.length) : "",
      width: v.width !== null && v.width !== undefined ? String(v.width) : "",
      diameter: v.diameter !== null && v.diameter !== undefined ? String(v.diameter) : "",
      size: v.size || "Auto",
      qty: v.qty !== undefined ? String(v.qty) : "1",
      storage: v.storage || "",
      notes: v.notes || "",
      wetSafe: !!v.wet_safe,
      hasSmall: !!v.has_small,
      smallLength: v.small_length !== undefined ? String(v.small_length) : "",
      smallWidth: v.small_width !== undefined ? String(v.small_width) : "",
      planks: !!v.planks,
      plankLength: v.plank_length !== undefined ? String(v.plank_length) : "",
      plankWidth: v.plank_width !== undefined ? String(v.plank_width) : "",
      archived: !!v.archived
    });
  }

  function saveEdit(id) {
    function applyEdit(v) {
      if (v.id !== id) return v;
      var rebuilt = buildSurfaceObject({
        id: v.id,
        colorOverride: v.color,
        material: editFields.material,
        size: editFields.size,
        name: editFields.name.trim() || v.name,
        length: parseFloat(editFields.length) || null,
        width: parseFloat(editFields.width) || null,
        diameter: parseFloat(editFields.diameter) || null,
        qty: parseInt(editFields.qty, 10) || 1,
        storage: editFields.storage,
        archived: editFields.archived,
        planks: editFields.planks,
        plankLength: parseFloat(editFields.plankLength) || null,
        plankWidth: parseFloat(editFields.plankWidth) || null,
        wetSafe: editFields.wetSafe,
        hasSmall: editFields.hasSmall,
        smallLength: parseFloat(editFields.smallLength) || null,
        smallWidth: parseFloat(editFields.smallWidth) || null,
        notes: editFields.notes
      });
      if (v._photo) rebuilt._photo = v._photo;
      return rebuilt;
    }
    setQueue(function(p) { return p.map(applyEdit); });
    setSurfaces(function(p) { return p.map(function(v) { var u = applyEdit(v); delete u._photo; return u; }); });
    setEditingId(null);
    setDownloaded(false);
  }

  var dropZoneStyle = function(drag, active, ok) {
    return { border: "2px " + (active ? "solid" : "dashed") + " " + (drag ? "#1A1A18" : ok ? "#4CAF50" : "#DEDAD4"), borderRadius: 8, cursor: "pointer", background: drag ? "#EDE9E3" : ok ? "#F0FBF0" : "#fff", transition: "all 0.15s" };
  };

  return (
    <div style={{ fontFamily: "DM Mono,monospace", background: "#F5F2EE", minHeight: "100vh" }}>
      <link href="https://fonts.googleapis.com/css2?family=Barlow+Semi+Condensed:wght@400&family=DM+Mono:wght@300;400;500&family=Syne:wght@600;700;800&display=swap" rel="stylesheet" />

      {/* HEADER */}
      <div style={{ background: "#1A1A18", color: "#fff", padding: "0 24px", height: 52, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontFamily: "Barlow Semi Condensed,sans-serif", fontSize: 19 }}>PhotoKitchen</span>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontFamily: "Syne,sans-serif", fontWeight: 700, fontSize: 12, color: "#888", letterSpacing: "0.12em", textTransform: "uppercase" }}>Surface Uploader</span>
          <span style={{ fontFamily: "DM Mono,monospace", fontSize: 9, color: "#555", background: "#2A2A28", border: "1px solid #3A3A38", borderRadius: 3, padding: "2px 6px", letterSpacing: "0.08em" }}>V1</span>
        </div>
      </div>

      {/* HOW TO USE BAR */}
      <div style={{ background: "#D9D4CC", borderTop: "1px solid #C8C2B8", padding: "14px 24px 18px" }}>
        <div style={{ maxWidth: 660, margin: "0 auto" }}>
          <div style={{ fontFamily: "Syne,sans-serif", fontWeight: 700, fontSize: 11, color: "#9A9590", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 12 }}>How to use</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16 }}>
            {[
              ["STEP 1", "Load Color JS File", "Select color, download the JS file from GitHub, drag it in."],
              ["STEP 2", "Add Surface Details", "Upload a photo — name and material auto-generate. Fill dims and properties, add to queue. Repeat for each surface."],
              ["STEP 3", "Download Updated JS", "Click Download — the artifact merges your new surfaces into the color JS file directly. No Claude merge step needed."]
            ].map(function(s) {
              return (
                <div key={s[0]}>
                  <div style={{ fontFamily: "Syne,sans-serif", fontWeight: 700, fontSize: 11, color: "#9A9590", letterSpacing: "0.06em", marginBottom: 3 }}>{s[0]}</div>
                  <div style={{ fontFamily: "Syne,sans-serif", fontWeight: 700, fontSize: 11, color: "#4A4640", marginBottom: 5 }}>{s[1]}</div>
                  <div style={{ fontSize: 10, color: "#6B6860", lineHeight: 1.6 }}>{s[2]}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 660, margin: "0 auto", padding: "24px 20px" }}>

        {/* STEP 1 */}
        <div style={card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span style={{ fontFamily: "Syne,sans-serif", fontWeight: 700, fontSize: 14, color: "#C4C0B8", letterSpacing: "0.06em" }}>STEP 1</span>
              <span style={{ fontFamily: "Syne,sans-serif", fontWeight: 700, fontSize: 15, color: "#1A1A18" }}>Load Color JS File</span>
            </div>
            {loaded && <span style={{ fontSize: 10, color: "#4CAF50", fontFamily: "DM Mono,monospace" }}>{"✓ " + surfaces.length + " surfaces — " + jsFileName}</span>}
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={lbl}>Select Color Category</label>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <select value={colorKey} onChange={function(e) { setColorKey(e.target.value); }}
                style={{ flex: 1, boxSizing: "border-box", fontFamily: "DM Mono,monospace", fontSize: 12, padding: "8px 10px", border: "1.5px solid " + sw, borderRadius: 4, background: isWhite ? "#fff" : sw + "18", color: isWhite ? "#999" : sw, cursor: "pointer", outline: "none" }}>
                {COLOR_ORDER.map(function(k) { return <option key={k} value={k}>{COLOR_META[k].label + " (" + k + ")"}</option>; })}
              </select>
              <a href={"https://raw.githubusercontent.com/photokitchenfood/surfaces/main/data/" + colorKey + ".js"} target="_blank" rel="noreferrer"
                style={{ display: "flex", alignItems: "center", padding: "8px 14px", background: "#1A1A18", color: "#fff", borderRadius: 4, fontFamily: "DM Mono,monospace", fontSize: 11, textDecoration: "none", whiteSpace: "nowrap", flexShrink: 0 }}>
                Get JS File ↗
              </a>
            </div>
            <div style={{ marginTop: 6, fontSize: 10, color: "#C4C0B8", lineHeight: 1.6 }}>
              {"Download " + colorKey + ".js then drag it below. If it opens as text in your browser, right-click → Save Link As."}
            </div>
          </div>

          <div
            onDrop={function(e) { e.preventDefault(); setJsDrag(false); handleJsFile(e.dataTransfer.files[0]); }}
            onDragOver={function(e) { e.preventDefault(); setJsDrag(true); }}
            onDragLeave={function() { setJsDrag(false); }}
            onClick={function() { if (jsFileRef.current) jsFileRef.current.click(); }}
            style={Object.assign({}, dropZoneStyle(jsDrag, false, loaded), { padding: "22px 20px", textAlign: "center" })}
          >
            <input ref={jsFileRef} type="file" accept=".js" style={{ display: "none" }}
              onChange={function(e) { if (e.target.files && e.target.files[0]) handleJsFile(e.target.files[0]); }} />
            {loaded
              ? <div style={{ fontSize: 12, color: "#4CAF50" }}>
                  <div style={{ fontSize: 20, marginBottom: 4 }}>✓</div>
                  <strong>{jsFileName}</strong>{" — " + surfaces.length + " surfaces loaded"}
                  <div style={{ fontSize: 10, color: "#6B6860", marginTop: 4 }}>Click to load a different file</div>
                </div>
              : <div style={{ color: "#C4C0B8", fontSize: 11 }}>
                  <div style={{ fontSize: 22, marginBottom: 6 }}>📁</div>
                  Click or drag your <strong>data/[color].js</strong> file here
                </div>
            }
          </div>
        </div>

        {/* STEP 2 */}
        {loaded && (
          <div style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontFamily: "Syne,sans-serif", fontWeight: 700, fontSize: 14, color: "#C4C0B8", letterSpacing: "0.06em" }}>STEP 2</span>
                <span style={{ fontFamily: "Syne,sans-serif", fontWeight: 700, fontSize: 15, color: "#1A1A18" }}>Add Surface Details</span>
              </div>
              {nextId && <span style={{ fontFamily: "DM Mono,monospace", fontSize: 11, fontWeight: 600, color: "#1A1A18", letterSpacing: "0.06em" }}>{nextId}</span>}
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={lbl}>Photo <span style={{ color: "#C4C0B8", textTransform: "none", letterSpacing: 0 }}>(JPEG or PNG)</span></label>
              <div
                onDrop={function(e) { e.preventDefault(); setPhotoDrag(false); if (e.dataTransfer.files[0]) handlePhoto(e.dataTransfer.files[0]); }}
                onDragOver={function(e) { e.preventDefault(); setPhotoDrag(true); }}
                onDragLeave={function() { setPhotoDrag(false); }}
                onClick={function() { if (photoFileRef.current) photoFileRef.current.click(); }}
                style={Object.assign({}, dropZoneStyle(photoDrag, !!photo, false), photo ? { overflow: "hidden" } : { padding: "20px", textAlign: "center" })}
              >
                <input ref={photoFileRef} type="file" accept="image/*" style={{ display: "none" }}
                  onChange={function(e) { if (e.target.files && e.target.files[0]) handlePhoto(e.target.files[0]); }} />
                {describing
                  ? <div style={{ padding: "20px", textAlign: "center", color: "#C4C0B8", fontSize: 11 }}>Converting and analyzing image...</div>
                  : photo
                    ? <img src={photo} alt="surface" style={{ width: "100%", height: "auto", display: "block" }} />
                    : <div style={{ color: "#C4C0B8", fontSize: 11 }}>
                        <div style={{ fontSize: 22, marginBottom: 6 }}>📷</div>
                        Click or drag surface photo (PNG or JPEG)
                      </div>
                }
              </div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={lbl}>
                Name
                {!describing && nameAuto && <AutoBadge sw={sw} />}
              </label>
              <input type="text"
                value={name}
                onChange={function(e) { setName(e.target.value); setNameAuto(false); }}
                disabled={describing}
                placeholder={describing ? "Generating name..." : "e.g. Dark Burgundy Textured Painted Panel"}
                style={Object.assign({}, inp, { borderColor: nameErr ? "#D94040" : nameAuto ? sw : "#DEDAD4", color: describing ? "#C4C0B8" : "#1A1A18" })}
              />
              {apiError && <div style={{ marginTop: 6, fontSize: 10, color: "#D94040", lineHeight: 1.5 }}>{apiError}</div>}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
              <div>
                <label style={lbl}>Color <span style={{ color: "#C4C0B8" }}>(locked)</span></label>
                <div style={Object.assign({}, inp, { border: "1.5px solid " + sw, background: isWhite ? "#fff" : sw + "18", color: isWhite ? "#999" : sw, display: "flex", alignItems: "center", gap: 7, cursor: "default", userSelect: "none" })}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: sw, border: "1px solid rgba(0,0,0,0.1)", flexShrink: 0, display: "inline-block" }} />
                  {meta.label}
                </div>
              </div>
              <div>
                <label style={lbl}>Material {materialSuggested && <AutoBadge sw={sw} />}</label>
                <select value={material} onChange={function(e) { applyMaterial(e.target.value); setMaterialSuggested(false); }}
                  style={Object.assign({}, inp, { cursor: "pointer", borderColor: materialSuggested ? sw : "#DEDAD4" })}>
                  {MATERIALS.map(function(o) { return <option key={o} value={o}>{o}</option>; })}
                </select>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 10 }}>
              {[["L (cm)", length, setLength], ["W (cm)", width, setWidth], ["D (cm)", diameter, setDiameter]].map(function(item) {
                return (
                  <div key={item[0]}>
                    <label style={lbl}>{item[0]}</label>
                    <input type="number" value={item[1]} onChange={function(e) { item[2](e.target.value); }}
                      placeholder="--" step="0.5" min="0"
                      style={Object.assign({}, inp, { textAlign: "center", padding: "8px 4px" })} />
                  </div>
                );
              })}
              <div>
                <label style={lbl}>Size {sizeOverride === "Auto" && autoSizePreview && <span style={{ color: "#C4C0B8", textTransform: "none", letterSpacing: 0 }}>{"(" + autoSizePreview + ")"}</span>}</label>
                <select value={sizeOverride} onChange={function(e) { setSizeOverride(e.target.value); }}
                  style={Object.assign({}, inp, { cursor: "pointer", textAlign: "center", padding: "8px 4px" })}>
                  {SIZE_OPTIONS.map(function(o) { return <option key={o} value={o}>{o}</option>; })}
                </select>
              </div>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
              <Toggle sw={sw} label="Wet-Safe" checked={wetSafe} onChange={function() { setWetSafe(!wetSafe); setWetSafeTouched(true); }} />
              <Toggle sw={sw} label="Has Small Version" checked={hasSmall} onChange={function() { setHasSmall(!hasSmall); }} />
              <Toggle sw={sw} label="Planks / Tiles" checked={planks} onChange={function() { setPlanks(!planks); }} />
              <Toggle sw={sw} label="Archived" checked={archived} onChange={function() { setArchived(!archived); }} />
            </div>

            {hasSmall && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14, background: "#F5F2EE", border: "1px solid #DEDAD4", borderRadius: 6, padding: 12 }}>
                <div>
                  <label style={lbl}>Small Length (cm)</label>
                  <input type="number" value={smallLength} onChange={function(e) { setSmallLength(e.target.value); }} placeholder="--" step="0.5" min="0" style={Object.assign({}, inp, { background: "#fff", textAlign: "center" })} />
                </div>
                <div>
                  <label style={lbl}>Small Width (cm)</label>
                  <input type="number" value={smallWidth} onChange={function(e) { setSmallWidth(e.target.value); }} placeholder="--" step="0.5" min="0" style={Object.assign({}, inp, { background: "#fff", textAlign: "center" })} />
                </div>
              </div>
            )}

            {planks && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14, background: "#F5F2EE", border: "1px solid #DEDAD4", borderRadius: 6, padding: 12 }}>
                <div>
                  <label style={lbl}>Single Plank/Tile Length (cm)</label>
                  <input type="number" value={plankLength} onChange={function(e) { setPlankLength(e.target.value); }} placeholder="--" step="0.5" min="0" style={Object.assign({}, inp, { background: "#fff", textAlign: "center" })} />
                </div>
                <div>
                  <label style={lbl}>Single Plank/Tile Width (cm)</label>
                  <input type="number" value={plankWidth} onChange={function(e) { setPlankWidth(e.target.value); }} placeholder="--" step="0.5" min="0" style={Object.assign({}, inp, { background: "#fff", textAlign: "center" })} />
                </div>
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "72px 1fr 1fr", gap: 10, marginBottom: 18 }}>
              <div>
                <label style={lbl}>Qty</label>
                <input type="number" value={qty} onChange={function(e) { setQty(e.target.value); }} min="1"
                  style={Object.assign({}, inp, { textAlign: "center", padding: "8px 4px" })} />
              </div>
              <div>
                <label style={lbl}>Storage Location</label>
                <input type="text" value={storage} onChange={function(e) { setStorage(e.target.value); }} placeholder="e.g. Shelf A3" style={inp} />
              </div>
              <div>
                <label style={lbl}>Notes</label>
                <input type="text" value={notes} onChange={function(e) { setNotes(e.target.value); }} placeholder="Optional" style={inp} />
              </div>
            </div>

            <button onClick={addSurface} disabled={!canAdd}
              style={{ width: "100%", padding: "10px", background: canAdd ? "#1A1A18" : "#C4C0B8", color: "#fff", border: "none", borderRadius: 4, fontFamily: "DM Mono,monospace", fontSize: 12, cursor: canAdd ? "pointer" : "not-allowed", letterSpacing: "0.04em" }}>
              + Add to Queue
            </button>
          </div>
        )}

        {/* STEP 3 */}
        {queue.length > 0 && (
          <div style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontFamily: "Syne,sans-serif", fontWeight: 700, fontSize: 14, color: "#C4C0B8", letterSpacing: "0.06em" }}>STEP 3</span>
                <span style={{ fontFamily: "Syne,sans-serif", fontWeight: 700, fontSize: 15, color: "#1A1A18" }}>Review &amp; Download</span>
              </div>
              <span style={{ fontSize: 10, color: "#4CAF50", fontFamily: "DM Mono,monospace" }}>{queue.length + " surface" + (queue.length !== 1 ? "s" : "") + " ready"}</span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 18 }}>
              {queue.map(function(v) {
                var dimBits = [];
                if (v.diameter) dimBits.push("Ø" + v.diameter + "cm");
                if (v.length) dimBits.push("L:" + v.length + "cm");
                if (v.width) dimBits.push("W:" + v.width + "cm");
                return (
                  <div key={v.id}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "#F5F2EE", borderRadius: editingId === v.id ? "6px 6px 0 0" : 6, border: "1px solid #DEDAD4" }}>
                      {v._photo
                        ? <img src={v._photo} alt="" style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 4, flexShrink: 0 }} />
                        : <div style={{ width: 40, height: 40, background: "#DEDAD4", borderRadius: 4, flexShrink: 0 }} />
                      }
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontFamily: "Syne,sans-serif", fontSize: 12, fontWeight: 600, color: "#1A1A18", marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.name}</div>
                        <div style={{ fontSize: 10, color: "#6B6860" }}>{v.id + " · " + v.material + (dimBits.length ? " · " + dimBits.join(" · ") : "")}</div>
                      </div>
                      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                        <button onClick={function() { if (editingId === v.id) setEditingId(null); else startEdit(v); }}
                          style={{ background: "none", border: "1px solid #DEDAD4", borderRadius: 3, cursor: "pointer", color: "#6B6860", fontSize: 10, fontFamily: "DM Mono,monospace", padding: "2px 8px" }}>
                          {editingId === v.id ? "cancel" : "edit"}
                        </button>
                        <button onClick={function() { removeFromQueue(v.id); }}
                          style={{ background: "none", border: "none", cursor: "pointer", color: "#C4C0B8", fontSize: 18, lineHeight: 1, padding: "0 2px" }}>×</button>
                      </div>
                    </div>

                    {editingId === v.id && (
                      <div style={{ background: "#F5F2EE", border: "1px solid #DEDAD4", borderTop: "1px solid #E8E4DE", borderRadius: "0 0 6px 6px", padding: "12px 12px 14px" }}>
                        <div style={{ marginBottom: 10 }}>
                          <label style={lbl}>Name</label>
                          <input type="text" value={editFields.name} onChange={function(e) { var val = e.target.value; setEditFields(function(p) { return Object.assign({}, p, { name: val }); }); }}
                            style={Object.assign({}, inp, { background: "#fff" })} />
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
                          <div>
                            <label style={lbl}>Material</label>
                            <select value={editFields.material} onChange={function(e) { var val = e.target.value; setEditFields(function(p) { return Object.assign({}, p, { material: val }); }); }}
                              style={Object.assign({}, inp, { background: "#fff", cursor: "pointer" })}>
                              {MATERIALS.map(function(o) { return <option key={o} value={o}>{o}</option>; })}
                            </select>
                          </div>
                          <div>
                            <label style={lbl}>Size</label>
                            <select value={editFields.size} onChange={function(e) { var val = e.target.value; setEditFields(function(p) { return Object.assign({}, p, { size: val }); }); }}
                              style={Object.assign({}, inp, { background: "#fff", cursor: "pointer" })}>
                              {SIZE_OPTIONS.map(function(o) { return <option key={o} value={o}>{o}</option>; })}
                            </select>
                          </div>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginBottom: 10 }}>
                          {[["L", "length"], ["W", "width"], ["D", "diameter"]].map(function(pair) {
                            return (
                              <div key={pair[0]}>
                                <label style={lbl}>{pair[0]} cm</label>
                                <input type="number" value={editFields[pair[1]]} step="0.5" min="0" placeholder="--"
                                  onChange={function(e) { var val = e.target.value, key = pair[1]; setEditFields(function(p) { var u = Object.assign({}, p); u[key] = val; return u; }); }}
                                  style={Object.assign({}, inp, { background: "#fff", textAlign: "center", padding: "7px 4px" })} />
                              </div>
                            );
                          })}
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                          <Toggle sw={sw} label="Wet-Safe" checked={editFields.wetSafe} onChange={function() { setEditFields(function(p) { return Object.assign({}, p, { wetSafe: !p.wetSafe }); }); }} />
                          <Toggle sw={sw} label="Has Small Version" checked={editFields.hasSmall} onChange={function() { setEditFields(function(p) { return Object.assign({}, p, { hasSmall: !p.hasSmall }); }); }} />
                          <Toggle sw={sw} label="Planks / Tiles" checked={editFields.planks} onChange={function() { setEditFields(function(p) { return Object.assign({}, p, { planks: !p.planks }); }); }} />
                          <Toggle sw={sw} label="Archived" checked={editFields.archived} onChange={function() { setEditFields(function(p) { return Object.assign({}, p, { archived: !p.archived }); }); }} />
                        </div>
                        {editFields.hasSmall && (
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
                            <div>
                              <label style={lbl}>Small L (cm)</label>
                              <input type="number" value={editFields.smallLength} step="0.5" min="0" placeholder="--"
                                onChange={function(e) { var val = e.target.value; setEditFields(function(p) { return Object.assign({}, p, { smallLength: val }); }); }}
                                style={Object.assign({}, inp, { background: "#fff", textAlign: "center" })} />
                            </div>
                            <div>
                              <label style={lbl}>Small W (cm)</label>
                              <input type="number" value={editFields.smallWidth} step="0.5" min="0" placeholder="--"
                                onChange={function(e) { var val = e.target.value; setEditFields(function(p) { return Object.assign({}, p, { smallWidth: val }); }); }}
                                style={Object.assign({}, inp, { background: "#fff", textAlign: "center" })} />
                            </div>
                          </div>
                        )}
                        {editFields.planks && (
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
                            <div>
                              <label style={lbl}>Plank L (cm)</label>
                              <input type="number" value={editFields.plankLength} step="0.5" min="0" placeholder="--"
                                onChange={function(e) { var val = e.target.value; setEditFields(function(p) { return Object.assign({}, p, { plankLength: val }); }); }}
                                style={Object.assign({}, inp, { background: "#fff", textAlign: "center" })} />
                            </div>
                            <div>
                              <label style={lbl}>Plank W (cm)</label>
                              <input type="number" value={editFields.plankWidth} step="0.5" min="0" placeholder="--"
                                onChange={function(e) { var val = e.target.value; setEditFields(function(p) { return Object.assign({}, p, { plankWidth: val }); }); }}
                                style={Object.assign({}, inp, { background: "#fff", textAlign: "center" })} />
                            </div>
                          </div>
                        )}
                        <div style={{ display: "grid", gridTemplateColumns: "72px 1fr 1fr", gap: 8, marginBottom: 12 }}>
                          <div>
                            <label style={lbl}>Qty</label>
                            <input type="number" value={editFields.qty} min="1"
                              onChange={function(e) { var val = e.target.value; setEditFields(function(p) { return Object.assign({}, p, { qty: val }); }); }}
                              style={Object.assign({}, inp, { background: "#fff", textAlign: "center", padding: "7px 4px" })} />
                          </div>
                          <div>
                            <label style={lbl}>Storage</label>
                            <input type="text" value={editFields.storage} placeholder="Optional"
                              onChange={function(e) { var val = e.target.value; setEditFields(function(p) { return Object.assign({}, p, { storage: val }); }); }}
                              style={Object.assign({}, inp, { background: "#fff" })} />
                          </div>
                          <div>
                            <label style={lbl}>Notes</label>
                            <input type="text" value={editFields.notes} placeholder="Optional"
                              onChange={function(e) { var val = e.target.value; setEditFields(function(p) { return Object.assign({}, p, { notes: val }); }); }}
                              style={Object.assign({}, inp, { background: "#fff" })} />
                          </div>
                        </div>
                        <button onClick={function() { saveEdit(v.id); }}
                          style={{ width: "100%", padding: "8px", background: "#1A1A18", color: "#fff", border: "none", borderRadius: 4, fontFamily: "DM Mono,monospace", fontSize: 11, cursor: "pointer" }}>
                          Save changes
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <button
              onClick={function() {
                mergeAndDownload(rawJs, queue, colorKey);
                setDownloaded(true);
              }}
              style={{ width: "100%", padding: "11px", background: "#1A1A18", color: "#fff", border: "none", borderRadius: 4, fontFamily: "DM Mono,monospace", fontSize: 12, cursor: "pointer", letterSpacing: "0.04em", marginBottom: 10 }}>
              ↓ Download Updated JS
            </button>

            {downloaded && (
              <div style={{ background: "#F0FBF0", border: "1px solid #4CAF5055", borderRadius: 6, padding: "12px 14px", fontSize: 10, color: "#2E7D32", lineHeight: 1.7, fontFamily: "DM Mono,monospace" }}>
                <strong style={{ display: "block", marginBottom: 4 }}>{"✓ " + colorKey + ".js downloaded — ready to push."}</strong>
                New surfaces are already merged in. Just drag <strong>{colorKey + ".js"}</strong> into GitHub Desktop and push.
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
