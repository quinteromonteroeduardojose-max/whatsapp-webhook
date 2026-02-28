/**
 * Smart Money Futures WhatsApp Bot (Cloud API)
 * Fixes: duplicate replies + delays by doing ACK immediately and strong dedupe.
 *
 * Env required:
 *  - PORT
 *  - VERIFY_TOKEN
 *  - WHATSAPP_TOKEN
 *  - PHONE_NUMBER_ID
 *
 * Optional:
 *  - ADVISOR_WA / ASESOR_WA / ADVISOR_PHONE
 *  - ADVISOR_CO / ADVISOR_VE
 *  - USD_PAYMENT_LINK
 *  - BINANCE_ID / OKX_ID / BITGET_ID
 *  - USDT_TRC20_ADDRESS
 *  - USDT_QR_IMAGE
 */

const express = require("express");
const axios = require("axios");

try {
  require("dotenv").config();
} catch (_) {}

const app = express();
// ✅ Health check (Render)
app.get("/health", (req, res) => res.status(200).send("ok"));

// ✅ Webhook verification (Meta)
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

app.use(express.json({ limit: "10mb" }));

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "";

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN || process.env.ACCESS_TOKEN || "";
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || "";

const CHANNEL_PUBLIC_LINK = "https://t.me/MFuturesLab";
const VIP_PRICE = "39.99 USDT / USD";

const USDT_TRC20_ADDRESS = process.env.USDT_TRC20_ADDRESS || "";
const USDT_QR_IMAGE = process.env.USDT_QR_IMAGE || "";

const USD_PAYMENT_LINK = process.env.USD_PAYMENT_LINK || "";

const BINANCE_ID = process.env.BINANCE_ID || "";
const OKX_ID = process.env.OKX_ID || "";
const BITGET_ID = process.env.BITGET_ID || "";

const ADVISOR_WA =
  process.env.ADVISOR_WA ||
  process.env.ASESOR_WA ||
  process.env.ADVISOR_PHONE ||
  "";

const ADVISOR_CO = process.env.ADVISOR_CO || "";
const ADVISOR_VE = process.env.ADVISOR_VE || "";

/** =========================
 *  In-memory session store
 *  ========================= */
const sessions = new Map(); // waId -> { state, country, vipLead, lastSeen, ... }

/** =========================
 *  Strong Dedupe (ACK-first safe)
 *  =========================
 *  Meta sometimes retries delivery with different message ids.
 *  We dedupe using a "fingerprint" for 60 seconds.
 */
const dedupeCache = new Map(); // fingerprint -> expiresAt(ms)
const DEDUPE_TTL_MS = 60 * 1000;

function cleanupDedupe() {
  const now = Date.now();
  for (const [k, exp] of dedupeCache.entries()) {
    if (exp <= now) dedupeCache.delete(k);
  }
}

function makeFingerprint({ waId, type, text, tsBucket }) {
  // tsBucket is a coarse bucket to dedupe re-deliveries
  return `${waId}|${type}|${(text || "").trim().toLowerCase()}|${tsBucket}`;
}

function isDuplicate(fp) {
  cleanupDedupe();
  const now = Date.now();
  const exp = dedupeCache.get(fp);
  if (exp && exp > now) return true;
  dedupeCache.set(fp, now + DEDUPE_TTL_MS);
  return false;
}

function getSession(waId) {
  if (!sessions.has(waId)) {
    sessions.set(waId, {
      state: "MENU",
      country: null,
      vipLead: false,
      payState: null, // "PAY_USDT_WAIT_CONFIRM" | "PAY_USDT_SENT" | "PAY_WAIT_RECEIPT"
      lastSeen: Date.now(),
    });
  }
  const s = sessions.get(waId);
  s.lastSeen = Date.now();
  return s;
}

/** =========================
 *  WhatsApp send helpers
 *  ========================= */
async function waSend(payload) {
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
    console.log("⚠️ Falta WHATSAPP_TOKEN o PHONE_NUMBER_ID.");
    return;
  }
  const url = `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`;
  try {
    await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      timeout: 15000,
    });
  } catch (err) {
    const data = err?.response?.data || err?.message || err;
    console.log("❌ send error:", data);
  }
}

async function sendText(to, text) {
  return waSend({
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: text },
  });
}

async function sendImageByLink(to, link, caption = "") {
  if (!link) return;
  return waSend({
    messaging_product: "whatsapp",
    to,
    type: "image",
    image: {
      link,
      ...(caption ? { caption } : {}),
    },
  });
}

/** =========================
 *  Message Builders
 *  ========================= */
function menuText() {
  return (
`👋 Hola.
✅ *Acceso oficial a Smart Money Futures*

Selecciona una opción:

1️⃣ Acceder al canal público
2️⃣ Información sobre el VIP
3️⃣ Preguntas generales

💳 Para pagos escribe *PAGO*
👨‍💼 Para un asesor humano escribe *ASESOR*`
  );
}

function publicChannelText() {
  return (
`📣 *Canal público (gratis)*

🔗 ${CHANNEL_PUBLIC_LINK}

📈 Publicamos análisis estructural diario.

🌎 ¿Desde qué país nos escribes?
1) Colombia  2) México  3) Argentina  4) España
O escribe tu país.`
  );
}

function vipInfoText() {
  return (
`💎 *VIP Smart Money Futures*

Incluye:
✅ Entradas exactas
✅ Gestión activa
✅ Parciales
✅ Actualizaciones en tiempo real

💰 *Precio:* ${VIP_PRICE}

🔒 Actualmente está en *fase privada*.
¿Deseas ser notificado cuando se habiliten cupos?

Responde: *SI* ✅

💳 Para ver métodos de pago escribe: *PAGO*`
  );
}

function faqText() {
  return (
`❓ *Preguntas generales (FAQ)*

✅ No se promete rentabilidad.
✅ Operamos con gestión de riesgo.
✅ No todos los días se opera.
✅ La información es educativa y de apoyo.

Si tu pregunta es diferente, escríbela aquí y te respondemos.

💳 Pagos: *PAGO*
👨‍💼 Asesor: *ASESOR*
↩️ Menú: *MENU*`
  );
}

function paymentsMenuText() {
  return (
`💳 *Métodos de pago oficiales*

1️⃣ USDT (Red TRC20) — Recomendado 💎
2️⃣ Pago internacional en USD (Link seguro) 🌍
3️⃣ Transferencia interna por Exchange 🔐

Responde *1, 2 o 3*.
(Para volver al menú escribe *MENU*)`
  );
}

function usdtConfirmText() {
  return (
`💎 *Pago en USDT (Red TRC20)*

Para protegerte y evitar errores de red, primero confirma:

✅ Responde *CONFIRMAR* para recibir la dirección de pago.
❌ Responde *CANCELAR* para volver.`
  );
}

function usdtDetailsText(address) {
  return (
`💎 *USDT (TRC20) — Dirección oficial*

📍 ${address}

⚠️ Envía *únicamente USDT* por red *TRC20 (TRON)*.
No enviar ERC20 ni BEP20.

📩 Después de transferir, envía el *comprobante* aquí para validar ✅`
  );
}

function usdLinkText(link) {
  if (!link) {
    return (
`🌍 *Pago internacional en USD (Link seguro)*

✅ Disponible bajo solicitud.
Escribe *ASESOR* y te enviamos el link seguro.`
    );
  }
  return (
`🌍 *Pago internacional en USD (Link seguro)*

🔗 ${link}

📩 Al completar el pago, envía el comprobante aquí ✅`
  );
}

function exchangeMenuText() {
  return (
`🔐 *Transferencia interna por Exchange*

Elige tu exchange:
1) Binance
2) OKX
3) Bitget

Responde *1, 2 o 3*.`
  );
}

function advisorLinkByCountry(waId) {
  // waId comes like "57..." or "58..."
  if (waId.startsWith("57") && ADVISOR_CO) return ADVISOR_CO;
  if (waId.startsWith("58") && ADVISOR_VE) return ADVISOR_VE;
  return ADVISOR_WA;
}

function advisorText(waId) {
  const n = advisorLinkByCountry(waId);
  if (!n) {
    return "✅ Te paso con un asesor humano. Por favor indícame tu país y te comparto el contacto 📲";
  }
  return (
`✅ Te paso con un asesor humano ahora mismo 👨‍💼📲
Escríbenos aquí: https://wa.me/${n}

Envía *Hola* + tu país y lo que necesitas para atenderte más rápido 🚀`
  );
}

/** =========================
 *  Routes
 *  ========================= */

// Verify webhook
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

app.get("/health", (_req, res) => res.status(200).send("ok"));

// Main webhook
app.post("/webhook", (req, res) => {
  // ✅ ACK IMMEDIATELY to avoid Meta retries
  res.sendStatus(200);

  // Process asynchronously
  setImmediate(() => {
    try {
      handleWebhook(req.body);
    } catch (e) {
      console.log("❌ handle error:", e?.message || e);
    }
  });
});

/** =========================
 *  Webhook handler
 *  ========================= */
function extractMessages(body) {
  const entry = body?.entry?.[0];
  const changes = entry?.changes?.[0];
  const value = changes?.value;

  const messages = value?.messages || [];
  return messages;
}

function extractWaId(body) {
  const entry = body?.entry?.[0];
  const changes = entry?.changes?.[0];
  const value = changes?.value;

  const contacts = value?.contacts?.[0];
  const waId = contacts?.wa_id;

  // If contacts missing, try from messages
  const msgWaId = value?.messages?.[0]?.from;

  return waId || msgWaId || null;
}

function normalizeText(t) {
  return (t || "").trim();
}

function isMenuCommand(t) {
  const x = normalizeText(t).toLowerCase();
  return x === "menu" || x === "menú" || x === "inicio";
}

function handleWebhook(body) {
  const waId = extractWaId(body);
  if (!waId) return;

  const messages = extractMessages(body);
  if (!messages.length) return;

  for (const msg of messages) {
    const type = msg.type; // "text", "image", "document", ...
    const timestamp = Number(msg.timestamp || Date.now() / 1000);
    const tsBucket = Math.floor(timestamp / 5); // 5s bucket

    let text = "";
    if (type === "text") text = msg.text?.body || "";
    if (type === "button") text = msg.button?.text || "";
    if (type === "interactive") {
      // Depending on interactive type; keep safe fallback
      text = msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title || "";
    }

    const fp = makeFingerprint({
      waId,
      type: type || "unknown",
      text: text || (type === "image" ? "image" : type === "document" ? "document" : ""),
      tsBucket,
    });

    if (isDuplicate(fp)) {
      // console.log("🟡 Duplicate ignored:", fp);
      continue;
    }

    routeMessage(waId, msg, text);
  }
}

async function routeMessage(waId, msg, textRaw) {
  const session = getSession(waId);
  const text = normalizeText(textRaw);

  // Global commands
  if (isMenuCommand(text)) {
    session.state = "MENU";
    session.payState = null;
    await sendText(waId, menuText());
    return;
  }

  if (text.toLowerCase() === "pago") {
    session.state = "PAY_MENU";
    session.payState = null;
    await sendText(waId, paymentsMenuText());
    return;
  }

  if (text.toLowerCase() === "asesor") {
    await sendText(waId, advisorText(waId));
    return;
  }

  // If waiting for receipt and user sends image/doc -> acknowledge receipt
  if (session.payState === "PAY_WAIT_RECEIPT") {
    if (msg.type === "image" || msg.type === "document") {
      await sendText(waId, "✅ Comprobante recibido. Validando transacción ⏳\nSi falta algún dato, te escribimos por aquí.");
      // Keep state so multiple receipts don't loop menus
      return;
    }
    // If they send text while waiting, guide
    if (msg.type === "text") {
      await sendText(waId, "📩 Por favor envía el *comprobante* (captura o PDF) aquí para validar ✅\n↩️ Menú: *MENU*");
      return;
    }
  }

  // Main state machine
  switch (session.state) {
    case "MENU": {
      // Accept 1/2/3
      if (text === "1") {
        session.state = "ASK_COUNTRY";
        await sendText(waId, publicChannelText());
        return;
      }
      if (text === "2") {
        session.state = "VIP_INFO";
        await sendText(waId, vipInfoText());
        return;
      }
      if (text === "3") {
        session.state = "FAQ";
        await sendText(waId, faqText());
        return;
      }
      // If unknown, show menu once
      await sendText(waId, menuText());
      return;
    }

    case "ASK_COUNTRY": {
      // user can reply 1-4 or country name
      const lower = text.toLowerCase();
      let country = null;
      if (text === "1" || lower.includes("col")) country = "Colombia";
      else if (text === "2" || lower.includes("mex")) country = "México";
      else if (text === "3" || lower.includes("arg")) country = "Argentina";
      else if (text === "4" || lower.includes("espa") || lower.includes("spain")) country = "España";
      else if (text.length >= 2) country = text;

      if (country) {
        session.country = country;
        session.state = "MENU";
        await sendText(waId, `✅ País registrado: *${country}*\n\nSi quieres volver al inicio escribe *MENU*.`);
        return;
      }

      await sendText(
        waId,
        "🌎 ¿Desde qué país nos escribes?\n1) Colombia  2) México  3) Argentina  4) España\nO escribe tu país."
      );
      return;
    }

    case "VIP_INFO": {
      if (text.toLowerCase() === "si" || text.toLowerCase() === "sí") {
        session.vipLead = true;
        session.state = "ASK_COUNTRY";
        await sendText(
          waId,
          "✅ Perfecto. Te anoto para avisarte cuando se abran cupos VIP.\n\n🌎 ¿Desde qué país nos escribes?\n1) Colombia  2) México  3) Argentina  4) España\nO escribe tu país."
        );
        return;
      }
      // If they ask something else, keep VIP info once
      await sendText(waId, "Para notificarte cuando haya cupos VIP, responde *SI* ✅\n\n💳 Pagos: *PAGO*\n↩️ Menú: *MENU*");
      return;
    }

    case "FAQ": {
      // Any text goes to general handling; keep it simple
      await sendText(waId, "✅ Recibido. En breve te respondemos.\n\n↩️ Menú: *MENU*\n💳 Pagos: *PAGO*\n👨‍💼 Asesor: *ASESOR*");
      session.state = "MENU";
      return;
    }

    case "PAY_MENU": {
      if (text === "1") {
        session.state = "PAY_USDT";
        session.payState = "PAY_USDT_WAIT_CONFIRM";
        await sendText(waId, usdtConfirmText());
        return;
      }
      if (text === "2") {
        session.state = "PAY_USD_LINK";
        await sendText(waId, usdLinkText(USD_PAYMENT_LINK));
        session.payState = "PAY_WAIT_RECEIPT";
        return;
      }
      if (text === "3") {
        session.state = "PAY_EXCHANGE";
        await sendText(waId, exchangeMenuText());
        return;
      }
      await sendText(waId, paymentsMenuText());
      return;
    }

    case "PAY_USDT": {
      const lower = text.toLowerCase();
      if (lower === "cancelar") {
        session.state = "PAY_MENU";
        session.payState = null;
        await sendText(waId, paymentsMenuText());
        return;
      }
      if (lower === "confirmar") {
        if (!USDT_TRC20_ADDRESS) {
          await sendText(waId, "⚠️ Aún no está configurada la dirección USDT TRC20. Escribe *ASESOR* para ayudarte.");
          return;
        }
        await sendText(waId, usdtDetailsText(USDT_TRC20_ADDRESS));
        if (USDT_QR_IMAGE) {
          await sendImageByLink(waId, USDT_QR_IMAGE, "📸 QR USDT (TRC20)");
        }
        session.payState = "PAY_WAIT_RECEIPT";
        // Keep in a pay state but allow menu commands anytime
        session.state = "PAY_MENU";
        return;
      }
      await sendText(waId, usdtConfirmText());
      return;
    }

    case "PAY_EXCHANGE": {
      if (text === "1") {
        if (!BINANCE_ID) return sendText(waId, "🔐 Binance: disponible bajo solicitud. Escribe *ASESOR* ✅");
        session.payState = "PAY_WAIT_RECEIPT";
        session.state = "PAY_MENU";
        return sendText(waId, `🔐 *Binance*\nID/Pay: *${BINANCE_ID}*\n\n📩 Luego envía el comprobante aquí ✅`);
      }
      if (text === "2") {
        if (!OKX_ID) return sendText(waId, "🔐 OKX: disponible bajo solicitud. Escribe *ASESOR* ✅");
        session.payState = "PAY_WAIT_RECEIPT";
        session.state = "PAY_MENU";
        return sendText(waId, `🔐 *OKX*\nID: *${OKX_ID}*\n\n📩 Luego envía el comprobante aquí ✅`);
      }
      if (text === "3") {
        if (!BITGET_ID) return sendText(waId, "🔐 Bitget: disponible bajo solicitud. Escribe *ASESOR* ✅");
        session.payState = "PAY_WAIT_RECEIPT";
        session.state = "PAY_MENU";
        return sendText(waId, `🔐 *Bitget*\nID: *${BITGET_ID}*\n\n📩 Luego envía el comprobante aquí ✅`);
      }
      await sendText(waId, exchangeMenuText());
      return;
    }

    default: {
      // Default fallback
      session.state = "MENU";
      await sendText(waId, menuText());
      return;
    }
  }
}

app.listen(PORT, () => {
  // ===============================
// 🔥 RUTAS DE VERIFICACIÓN
// ===============================

app.get("/health", (req, res) => {
  res.status(200).send("ok");
});

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});
  
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
    console.log("⚠️ Revisa WHATSAPP_TOKEN y PHONE_NUMBER_ID en tu .env");
  }
  console.log(`✅ Bot activo. Puerto: ${PORT}`);
});
