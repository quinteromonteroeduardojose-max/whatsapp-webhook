// ============================================================================
// WhatsApp Cloud API Bot - PRODUCCIÓN (Audífonos CO + Paletizadora Inteligente)
// ============================================================================

require("dotenv").config();
const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "mi_token_webhook";

const ACCESS_TOKEN =
  (process.env.WHATSAPP_TOKEN ||
    process.env.ACCESS_TOKEN ||
    process.env.TOKEN ||
    "").trim();

const PHONE_NUMBER_ID = (process.env.PHONE_NUMBER_ID || "").trim();

// -------------------- Asesor (handoff externo) --------------------
// Números de asesores en formato internacional SIN "+" ni espacios. Ej: "573001234567"
const ADVISOR_WA =
  (process.env.ADVISOR_WA ||
    process.env.ASESOR_WA ||
    process.env.ADVISOR_PHONE ||
    "").toString().trim().replace(/\D/g, "");

const ADVISOR_CO = (process.env.ADVISOR_CO || "").toString().trim().replace(/\D/g, "");
const ADVISOR_VE = (process.env.ADVISOR_VE || "").toString().trim().replace(/\D/g, "");
const ADVISOR_DEFAULT = (process.env.ADVISOR_DEFAULT || "").toString().trim().replace(/\D/g, "");

// Decide qué asesor usar según el país del cliente (prefijo del wa_id).
function pickAdvisorNumber(waId) {
  if (ADVISOR_WA) return ADVISOR_WA; // override global
  const id = (waId || "").toString().trim();
  if (id.startsWith("57") && ADVISOR_CO) return ADVISOR_CO; // Colombia
  if (id.startsWith("58") && ADVISOR_VE) return ADVISOR_VE; // Venezuela
  if (ADVISOR_DEFAULT) return ADVISOR_DEFAULT;
  // fallback: si hay uno solo configurado, úsalo
  if (ADVISOR_CO && !ADVISOR_VE) return ADVISOR_CO;
  if (ADVISOR_VE && !ADVISOR_CO) return ADVISOR_VE;
  return "";
}

function advisorLink(waId) {
  const num = pickAdvisorNumber(waId);
  return num ? `https://wa.me/${num}` : null;
}

function handoffExternalText(waId) {
  const link = advisorLink(waId);
  if (!link) {
    return "✅ Listo. Te paso con un asesor humano 👨‍💼📲\nEn breve te escriben por acá.\n\nSi quieres volver al bot escribe *MENU*.";
  }
  return `✅ Listo. Te paso con un asesor humano 👨‍💼📲\nEscríbenos aquí: ${link}\n\nEnvíale *Hola* + tu ciudad y lo que necesitas para atenderte más rápido 🚀\n\nSi quieres volver al bot escribe *MENU*.`;
}

if (!ACCESS_TOKEN || !PHONE_NUMBER_ID) {
  console.warn("⚠️ Falta WHATSAPP_TOKEN/ACCESS_TOKEN o PHONE_NUMBER_ID en variables de entorno.");
}

if (!ADVISOR_WA && !ADVISOR_CO && !ADVISOR_VE && !ADVISOR_DEFAULT) {
  console.warn("⚠️ Falta ADVISOR_WA o (ADVISOR_CO/ADVISOR_VE) para handoff externo.");
}

// -------------------- Helpers --------------------
const nowMs = () => Date.now();

function formatCOP(n) {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function normalizeText(s) {
  return (s || "")
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, ""); // elimina tildes
}

function body(message) {
  return (message?.text?.body || "").toString().trim();
}

function hasAny(text, words) {
  return words.some((w) => text.includes(w));
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

// -------------------- Keywords (intención) --------------------
const KW_PELLET = [
  "palet", "pellet", "pelet", "peletiz", "paletiz",
  "alimento", "animal", "concentrado", "balanceado",
  "kg/h", "kgh", "kg hora", "kilos", "hora", "produccion", "producción",
  "motor", "matriz", "rodillo", "220v", "380v", "trif", "trifas", "trifás", "mono", "monof",
  "granja", "gallina", "pollo", "cerdo", "vaca", "ganado", "perro", "gato", "conejo", "pescado",
  "pelletizadora", "paletizadora", "pellets"
];

const KW_AUD = [
  "audif", "audi", "tws", "bluetooth", "headset", "gamer",
  "f9", "g11", "m25", "m28", "pro 6", "pro6"
];

const KW_HUMAN = ["asesor", "humano", "persona", "vendedor", "agente", "ayuda", "llamar"];

// -------------------- Menús --------------------
function mainMenu() {
  return `Hola 👋 ¿Qué buscas hoy?

1) 🎧 *Audífonos* (contra entrega en Colombia)
2) 🏭 *Paletizadora* (cotización por capacidad)

Responde *1* o *2* (o escribe *ASESOR*).`;
}

function audMenu() {
  return `🎧 *Audífonos Bluetooth disponibles*
🚚 Envío contra entrega incluido en Colombia 🇨🇴

1️⃣ F9 🔥 Más vendido – $45.000
2️⃣ G11 – $45.000
3️⃣ M25 – $49.000
4️⃣ M28 Gamer 🎮 Modo juego – $49.000
5️⃣ Pro 6 – $49.000

Escribe el número del modelo que deseas 👇`;
}

function audPick(choice) {
  switch (choice) {
    case "1": return { product: "F9 🔥 Más vendido", unit: 45000 };
    case "2": return { product: "G11", unit: 45000 };
    case "3": return { product: "M25", unit: 49000 };
    case "4": return { product: "M28 Gamer 🎮", unit: 49000 };
    case "5": return { product: "Pro 6", unit: 49000 };
    default: return null;
  }
}

// -------------------- Paletizadora: extracción inteligente --------------------
function extractKgh(text) {
  const s = (text || "").toLowerCase().replace(",", ".");
  let m = s.match(/(\d{2,4})\s*(kg\/h|kgh|kg\s*hora|kilos\s*hora|kilos\/h)/);
  if (!m) m = s.match(/\b(\d{2,4})\b/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (!Number.isFinite(n)) return null;
  if (n < 50 || n > 5000) return null;
  return n;
}

function detectVoltage(text) {
  const t = (text || "").toLowerCase();
  if (t.includes("380") || t.includes("trif") || t.includes("3 fase") || t.includes("tres fase")) return "380V (trifásico)";
  if (t.includes("220") || t.includes("110") || t.includes("mono") || t.includes("1 fase") || t.includes("una fase")) return "220V/110V (monofásico)";
  return null;
}

function detectUse(text) {
  const t = (text || "").toLowerCase();
  if (t.includes("contin") || t.includes("24/7") || t.includes("24x7")) return "Continua";
  if (t.includes("tanda") || t.includes("intermit")) return "Por tandas";
  return null;
}

function detectAnimals(text) {
  const t = (text || "").toLowerCase();
  const hits = [];
  const map = [
    ["pollo", "Aves"], ["gallina", "Aves"], ["aves", "Aves"], ["ave", "Aves"],
    ["cerdo", "Porcinos"], ["cochino", "Porcinos"], ["porc", "Porcinos"],
    ["vaca", "Bovinos"], ["ganado", "Bovinos"], ["bov", "Bovinos"], ["res", "Bovinos"],
    ["perro", "Mascotas"], ["gato", "Mascotas"], ["mascota", "Mascotas"],
    ["conejo", "Conejos"],
    ["pez", "Peces"], ["pesc", "Peces"]
  ];
  for (const [k, v] of map) if (t.includes(k)) hits.push(v);
  if (!hits.length) return null;
  return Array.from(new Set(hits)).join(", ");
}

function recommendModel(kgh) {
  if (kgh <= 150) return { model: "ST-SL150", range: "150 kg/h", price: 1300 };
  if (kgh <= 200) return { model: "ST-SL160S", range: "150–200 kg/h", price: 1500 };
  if (kgh <= 300) return { model: "ST-SL210S", range: "200–300 kg/h", price: 2300 };
  return { model: "BAJO_PEDIDO", range: ">300 kg/h", price: null };
}

function pelletCard(rec) {
  if (rec.model === "ST-SL150") {
    return `🏭 *${rec.model}*
✅ Producción: *${rec.range}*
✅ Ideal para inicio (granja)
💰 Referencia: *$${rec.price}*`;
  }
  if (rec.model === "ST-SL160S") {
    return `🏭 *${rec.model}*
✅ Producción: *${rec.range}*
✅ Mejor estabilidad para granja mediana
💰 Referencia: *$${rec.price}*`;
  }
  if (rec.model === "ST-SL210S") {
    return `🏭 *${rec.model}*
✅ Producción: *${rec.range}*
✅ Uso industrial (volumen alto)
💰 Referencia: *$${rec.price}*`;
  }
  return `🏭 *MODELO INDUSTRIAL >300 kg/h*
✅ *Bajo pedido* (400, 500, 800 kg/h...)
✅ Se cotiza según necesidad exacta`;
}

function pelletPayText() {
  return `💳 *Formas de pago*
• 💵 Efectivo
• 🟡 Binance (USDT)
• 🇺🇸 Zelle
• 💱 Bs / moneda local (tasa a consultar)`;
}

function pelletSummary(p) {
  const parts = [];
  if (p.kgh) parts.push(`⚙️ *${p.kgh} kg/h*`);
  if (p.model) parts.push(`🏭 *${p.model}*`);
  if (p.animals) parts.push(`🐄 *${p.animals}*`);
  if (p.voltage) parts.push(`🔌 *${p.voltage}*`);
  if (p.use) parts.push(`⏱️ *${p.use}*`);
  if (p.city) parts.push(`📍 *${p.city}*`);
  return parts.join("\n");
}

function parsePelletFields(text) {
  const out = {};
  const kgh = extractKgh(text);
  const voltage = detectVoltage(text);
  const use = detectUse(text);
  const animals = detectAnimals(text);
  if (kgh) out.kgh = kgh;
  if (voltage) out.voltage = voltage;
  if (use) out.use = use;
  if (animals) out.animals = animals;

  const t = (text || "").toLowerCase();
  if (
    t.includes("colombia") || t.includes("venezuela") || t.includes("carabobo") ||
    t.includes("valencia") || t.includes("maracaibo") || t.includes("coro") || t.includes("falcon") ||
    t.includes("medellin") || t.includes("bogota") || t.includes("cali") ||
    t.includes("barrio") || t.includes("ciudad") || t.includes("estado") || t.includes("pais") || t.includes("país")
  ) {
    out.city = text.trim();
  }
  return out;
}

// -------------------- Sessions --------------------
const sessions = new Map();

function getSession(from) {
  if (!sessions.has(from)) {
    sessions.set(from, {
      step: "WELCOME",
      mode: "BOT",
      handoffTo: null,
      handoffAt: null,
      handoffNudgeAt: null,
      flow: null,
      countryConfirmed: null,
      lastSeen: nowMs(),
      pellet: {},
      product: null,
      unitPrice: null,
      qty: null,
      total: null,
      location: null,
      customerData: null
    });
  }
  const s = sessions.get(from);
  s.lastSeen = nowMs();
  return s;
}

// cleanup sessions
setInterval(() => {
  const ttlMs = 1000 * 60 * 60 * 6;
  const cutoff = nowMs() - ttlMs;
  for (const [k, v] of sessions.entries()) if ((v.lastSeen || 0) < cutoff) sessions.delete(k);
}, 1000 * 60 * 10);

// -------------------- WhatsApp send --------------------
async function sendText(to, text) {
  if (!ACCESS_TOKEN || !PHONE_NUMBER_ID) return;

  try {
    await axios.post(
      `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`,
      { messaging_product: "whatsapp", to, type: "text", text: { body: text } },
      { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } }
    );
  } catch (err) {
    console.error("❌ sendText error:", err.response?.data || err.message);
  }
}

// -------------------- Webhook verify (Meta) --------------------
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// -------------------- Webhook messages (SINGLE) --------------------
app.post("/webhook", (req, res) => {
  // ✅ ACK inmediato (evita reintentos/dobles mensajes)
  res.sendStatus(200);

  (async () => {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];

    // ignore statuses
    if (change?.value?.statuses) return;

    const message = change?.value?.messages?.[0];
    if (!message) return;

    // dedupe
    const msgId = message.id;
    globalThis._seenMessages ??= new Set();
    if (msgId && globalThis._seenMessages.has(msgId)) return;
    if (msgId) {
      globalThis._seenMessages.add(msgId);
      setTimeout(() => globalThis._seenMessages.delete(msgId), 1000 * 60 * 10);
    }

    const from = message.from || "";
    const session = getSession(from);

    const raw = body(message);
    let t = normalizeText(raw);

    // Commands
    if (t === "menu" || t === "inicio" || t === "start" || t === "reiniciar") {
      session.step = "WELCOME";
      session.mode = "BOT";
      session.handoffTo = null;
      session.handoffAt = null;
      session.handoffNudgeAt = null;
      session.flow = null;
      session.countryConfirmed = null;
      session.pellet = {};
      session.product = null;
      session.unitPrice = null;
      session.qty = null;
      session.total = null;
      session.location = null;
      session.customerData = null;
      await sendText(from, mainMenu());
      return;
    }

// Handoff externo a asesor (B1)
if (KW_HUMAN.some((k) => t.includes(k))) {
  session.mode = "HANDOFF_EXTERNAL";
  session.step = "HANDOFF_EXTERNAL";
  session.handoffTo = advisorLink(from);
  session.handoffAt = nowMs();
  session.handoffNudgeAt = nowMs();
  await sendText(from, handoffExternalText(from));
  return;
}


// Si el chat está en handoff externo, el bot no responde (salvo MENU)
if (session.mode === "HANDOFF_EXTERNAL") {
  const cooldownMs = 1000 * 60 * 30; // 30 min
  const last = session.handoffNudgeAt || 0;
  if (nowMs() - last > cooldownMs) {
    session.handoffNudgeAt = nowMs();
    await sendText(from, handoffExternalText(from));
  }
  return;
}

    if (t === "audifonos" || t === "audifonos") { session.flow = "AUD"; session.step = "AUD_COUNTRY_GATE"; }
    if (t === "paletizadora" || t === "peletizadora" || t === "pellet" || t === "pellets") { session.flow = "PELLET"; session.step = "PELLET_START"; }

    // Intent detection
    if (!session.flow && t) {
      const isPellet = hasAny(t, KW_PELLET);
      const isAud = hasAny(t, KW_AUD);
      if (isPellet) session.flow = "PELLET";
      else if (isAud) session.flow = "AUD";
    }

    // Welcome
    if (session.step === "WELCOME") {
      if (session.flow === "AUD") session.step = "AUD_COUNTRY_GATE";
      else if (session.flow === "PELLET") session.step = "PELLET_START";
      else {
        session.step = "CHOOSE_FLOW";
        await sendText(from, mainMenu());
        return;
      }
    }

    // Choose flow
    if (session.step === "CHOOSE_FLOW") {
      if (t === "1") { session.flow = "AUD"; session.step = "AUD_COUNTRY_GATE"; }
      else if (t === "2") { session.flow = "PELLET"; session.step = "PELLET_START"; }
      else {
        await sendText(from, "Responde *1* (Audífonos) o *2* (Paletizadora). O escribe *ASESOR*.");
        return;
      }
    }

    // ========================= AUD FLOW =========================
    if (session.flow === "AUD") {
      if (session.step === "AUD_COUNTRY_GATE") {
        if (from.startsWith("57")) {
          session.countryConfirmed = "CO";
          session.step = "AUD_SHOW";
        } else {
          session.step = "AUD_ASK_COUNTRY";
          await sendText(from, "👋 Para audífonos, ¿estás en *Colombia*? Responde *SI* o *NO* 🇨🇴");
          return;
        }
      }

      if (session.step === "AUD_ASK_COUNTRY") {
        if (t === "si") {
          session.countryConfirmed = "CO";
          session.step = "AUD_SHOW";
          await sendText(from, "Perfecto ✅ Te muestro los modelos disponibles 👇");
        } else {
          session.flow = null;
          session.step = "WELCOME";
          await sendText(from, `Por ahora los audífonos están disponibles con contra entrega solo en Colombia 🇨🇴.
Si buscas paletizadora escribe *PALETIZADORA*.`);
          return;
        }
      }

      if (session.step === "AUD_SHOW") {
        session.step = "AUD_PICK";
        await sendText(from, audMenu());
        return;
      }

      if (session.step === "AUD_PICK") {
        const picked = audPick(t);
        if (!picked) {
          await sendText(from, "Responde con un número del *1 al 5* para elegir modelo (o escribe *ASESOR*).");
          return;
        }
        session.product = picked.product;
        session.unitPrice = picked.unit;
        session.step = "AUD_QTY";
        await sendText(from, `🛍️ *${session.product}*\n💰 Precio unitario: *$${formatCOP(session.unitPrice)}*\n🚚 Envío contra entrega incluido en Colombia\n\n¿Cuántas unidades deseas? (1, 2, 3...)`);
        return;
      }

      if (session.step === "AUD_QTY") {
        let qty = parseInt(t, 10);
        if (!Number.isFinite(qty)) {
          if (t.includes("dos") || t.includes("los dos")) qty = 2;
          if (t.includes("tres")) qty = 3;
        }
        if (!Number.isFinite(qty) || qty < 1) {
          await sendText(from, "Por favor dime solo la cantidad (ej: 1, 2, 3...).");
          return;
        }
        qty = clamp(qty, 1, 20);
        session.qty = qty;
        session.total = session.unitPrice * qty;
        session.step = "AUD_LOCATION";
        await sendText(from, `Perfecto ✅ *${qty}* unidad(es)\n💰 Total: *$${formatCOP(session.total)}*\n\n¿En qué *ciudad* y *barrio* estás para programar la entrega? 📍`);
        return;
      }

      if (session.step === "AUD_LOCATION") {
        session.location = raw || "sin ubicación";
        session.step = "AUD_DATA";
        await sendText(from, "Listo ✅ Envíame en *un solo mensaje*:\n\n👤 Nombre completo\n📍 Dirección exacta\n📞 Número de contacto\n\nY te lo despacho contra entrega 🚚");
        return;
      }

      if (session.step === "AUD_DATA") {
        session.customerData = raw;
        session.step = "AUD_DONE";
        await sendText(from, `Pedido confirmado ✅\n🎧 ${session.product}\n📦 Cantidad: ${session.qty}\n💰 Total: $${formatCOP(session.total)} contra entrega\n📍 Zona: ${session.location}\n\nSi deseas cambiar modelo o cantidad escribe *MENU*. Si necesitas ayuda escribe *ASESOR* 🙌`);
        return;
      }

      if (session.step === "AUD_DONE") {
        await sendText(from, "✅ Listo. Escribe *MENU* para ver modelos o *ASESOR* si necesitas ayuda.");
        return;
      }
    }

    // ========================= PELLET FLOW =========================
    if (session.flow === "PELLET") {
      if (session.step === "PELLET_START") {
        session.pellet = session.pellet || {};
        const fields = parsePelletFields(raw);
        Object.assign(session.pellet, fields);

        if (!session.pellet.kgh) {
          session.step = "PELLET_ASK_KGH";
          await sendText(from, "🏭 *Paletizadoras para alimento animal*\nPara recomendarte el modelo exacto dime:\n⚙️ ¿Cuántos *kg/h* necesitas? (100, 150, 200, 250, 300 o más)\n\nEjemplo: *200 kg/h*");
          return;
        }

        session.step = "PELLET_AFTER_KGH";
      }

      if (session.step === "PELLET_ASK_KGH") {
        const kgh = extractKgh(raw) || extractKgh(t);
        if (!kgh) {
          await sendText(from, "Dime la capacidad en kg/h 🙌 Ej: *150 kg/h* o *250*");
          return;
        }
        session.pellet.kgh = kgh;
        session.step = "PELLET_AFTER_KGH";
      }

      if (session.step === "PELLET_AFTER_KGH") {
        const rec = recommendModel(session.pellet.kgh);
        session.pellet.model = rec.model;
        session.pellet.range = rec.range;
        session.pellet.price = rec.price;

        if (rec.model === "BAJO_PEDIDO") {
          session.step = "ASESOR";
          await sendText(from,
            `${pelletCard(rec)}\n\n✅ Para *+300 kg/h* trabajamos *bajo pedido*.\n` +
            `Para cotizarte exacto, envíame en un mensaje:\n` +
            `📍 Ciudad/país\n🔌 Voltaje (220V o 380V)\n🐄 Animal\n⚙️ Kg/h exactos\n\n` +
            `Escribe *ASESOR* y te atiendo directo 🤝`
          );
          return;
        }

        const fields = parsePelletFields(raw);
        Object.assign(session.pellet, fields);
        session.step = "PELLET_CONFIRM";
      }

      if (session.step === "PELLET_CONFIRM") {
        const fields = parsePelletFields(raw);
        Object.assign(session.pellet, fields);

        session.pellet.voltage = session.pellet.voltage || detectVoltage(raw);
        session.pellet.use = session.pellet.use || detectUse(raw);
        session.pellet.animals = session.pellet.animals || detectAnimals(raw);

        const missing = [];
        if (!session.pellet.animals) missing.push("🐄 animales (pollo, cerdo, ganado, etc.)");
        if (!session.pellet.voltage) missing.push("🔌 voltaje (220V o 380V)");
        if (!session.pellet.use) missing.push("⏱️ uso (continua o por tandas)");
        if (!session.pellet.city) missing.push("📍 ciudad/país");

        const rec = { model: session.pellet.model, range: session.pellet.range, price: session.pellet.price };

        if (missing.length) {
          await sendText(from,
            `${pelletCard(rec)}\n\n` +
            `✅ *Datos detectados*:\n${pelletSummary(session.pellet) || "—"}\n\n` +
            `Para cerrar la cotización solo me falta:\n• ${missing.join("\n• ")}\n\n` +
            `Respóndeme eso en *un solo mensaje* 🙌`
          );
          return;
        }

        session.step = "PELLET_CLOSE";
      }

      if (session.step === "PELLET_CLOSE") {
        await sendText(from,
          `✅ *Resumen final*\n${pelletSummary(session.pellet)}\n\n` +
          `🚛 Envío por empresa de transporte (costo según ciudad exacta).\n` +
          `${pelletPayText()}\n\n` +
          `Si deseas avanzar, envíame:\n👤 Nombre\n📞 Teléfono\n📍 Dirección/sector\n\n` +
          `O escribe *ASESOR* y te atiendo directo 🤝`
        );
        return;
      }
    }

    // ASESOR (fallback)
    if (session.step === "ASESOR") {
      await sendText(from, handoffExternalText(from));
      return;
    }

    await sendText(from, "Hola 👋 Escribe *MENU* para ver opciones o *ASESOR* para ayuda.");
  })().catch((e) => console.error("ERROR PROCESS:", e?.response?.data || e));
});

app.listen(PORT, () => {
  console.log("✅ Bot activo. Puerto:", PORT);
});
