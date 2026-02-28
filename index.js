require("dotenv").config();

const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

const PUBLIC_LINK = "https://t.me/MFuturesLab";
const VIP_PRICE = "39.99 USDT / USD";
const USDT_ADDRESS = process.env.USDT_TRC20_ADDRESS || "NO_CONFIGURADA";

const BUILD_TAG = process.env.BUILD_TAG || "v1";

/* ================================= */
/* ✅ ROOT (para confirmar deploy) */
/* ================================= */
app.get("/", (req, res) => {
  res.status(200).send(`OK SMART MONEY BOT - ${BUILD_TAG}`);
});

/* ================================= */
/* ✅ HEALTH CHECK */
/* ================================= */
app.get("/health", (req, res) => {
  res.status(200).send("ok");
});

/* ================================= */
/* ✅ WEBHOOK VERIFICATION (META) */
/* ================================= */
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

/* ================================= */
/* ✅ SEND WHATSAPP MESSAGE */
/* ================================= */
async function sendText(to, text) {
  try {
    await axios.post(
      `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: text }
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );
  } catch (error) {
    console.log("❌ Error enviando mensaje:", error.response?.data || error.message);
  }
}

/* ================================= */
/* ✅ MAIN WEBHOOK */
/* ================================= */
app.post("/webhook", async (req, res) => {
  res.sendStatus(200); // ACK inmediato

  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];

    if (!message) return;

    const from = message.from;
    const text = message.text?.body?.toLowerCase() || "";

    if (text === "menu") {
      return sendText(
        from,
        `👋 *Smart Money Futures*\n\n1️⃣ Canal Público\n2️⃣ Información VIP\n3️⃣ Preguntas\n\nEscribe el número de la opción.`
      );
    }

    if (text === "1") {
      return sendText(
        from,
        `📣 *Canal Público*\n\n🔗 ${PUBLIC_LINK}\n\nPublicamos análisis estructural diario.`
      );
    }

    if (text === "2") {
      return sendText(
        from,
        `💎 *VIP Smart Money Futures*\n\nIncluye:\n✅ Entradas exactas\n✅ Gestión activa\n✅ Parciales\n✅ Actualizaciones\n\n💰 Precio: ${VIP_PRICE}\n\nPara pagar escribe: PAGO`
      );
    }

    if (text === "pago") {
      return sendText(
        from,
        `💳 *Pago USDT (TRC20)*\n\nDirección:\n${USDT_ADDRESS}\n\n⚠️ Solo red TRC20\n\nEnvía el comprobante después del pago.`
      );
    }

  } catch (error) {
    console.log("❌ Webhook error:", error.message);
  }
});

/* ================================= */
/* ✅ START SERVER */
/* ================================= */
app.listen(PORT, () => {
  console.log(`✅ Bot activo. Puerto: ${PORT}`);
});
