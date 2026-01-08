import express from "express";
import cors from "cors";
import Razorpay from "razorpay";
import crypto from "crypto";
import admin from "firebase-admin";

/* ======================
   APP SETUP
====================== */
const app = express();

/* ======================
   CORS
====================== */
app.use(cors({
  origin: [
    "https://gangasolvo.web.app",
    "https://gangasolvo.firebaseapp.com",
    "http://localhost:8080"
  ]
}));

/* ======================
   WEBHOOK (RAW BODY) — MUST BE FIRST
====================== */
app.post(
  "/razorpay-webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    try {
      const signature = req.headers["x-razorpay-signature"];
      const secret = process.env.RAZORPAY_WEBHOOK_SECRET;

      const expected = crypto
        .createHmac("sha256", secret)
        .update(req.body)
        .digest("hex");

      if (signature !== expected) {
        return res.status(400).send("Invalid signature");
      }

      const event = JSON.parse(req.body.toString());

      if (event.event === "payment.captured") {
        const payment = event.payload.payment.entity;

        const uid = payment.notes?.uid;
        const courseId = payment.notes?.courseId;

        if (!uid || !courseId) {
          return res.status(200).send("Missing notes");
        }

        const ref = admin.database()
          .ref(`users/${uid}/courses/${courseId}`);

        const snap = await ref.get();
        if (!snap.exists()) {
          await ref.set({
            paid: true,
            paymentId: payment.id,
            orderId: payment.order_id,
            verifiedAt: Date.now(),
            source: "razorpay_webhook"
          });

          console.log("✅ Course unlocked via webhook");
        }
      }

      res.status(200).json({ ok: true });

    } catch (err) {
      console.error("❌ WEBHOOK ERROR:", err);
      res.status(500).send("Webhook error");
    }
  }
);

/* ======================
   JSON (AFTER WEBHOOK)
====================== */
app.use(express.json());

/* ======================
   ENV CHECK
====================== */
[
  "PORT",
  "RAZORPAY_KEY_ID",
  "RAZORPAY_KEY_SECRET",
  "RAZORPAY_WEBHOOK_SECRET",
  "FIREBASE_SERVICE_ACCOUNT_BASE64"
].forEach(v => {
  if (!process.env[v]) throw new Error(`${v} missing`);
});

/* ======================
   FIREBASE ADMIN
====================== */
const serviceAccount = JSON.parse(
  Buffer.from(
    process.env.FIREBASE_SERVICE_ACCOUNT_BASE64,
    "base64"
  ).toString("utf8")
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL:
    "https://gangasolvo-default-rtdb.asia-southeast1.firebasedatabase.app"
});

/* ======================
   RAZORPAY INIT
====================== */
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID.trim(),
  key_secret: process.env.RAZORPAY_KEY_SECRET.trim()
});

/* ======================
   HEALTH
====================== */
app.get("/health", (_, res) => {
  res.json({ status: "ok" });
});

/* ======================
   CREATE ORDER
====================== */
app.post("/create-order", async (req, res) => {
  try {
    const { amount, uid, courseId } = req.body;

    if (!amount || !uid || !courseId) {
      return res.status(400).json({ error: "Invalid payload" });
    }

    const order = await razorpay.orders.create({
      amount: Number(amount) * 100,
      currency: "INR",
      receipt: `course_${Date.now()}`,
      notes: {
        uid,
        courseId
      }
    });

    res.json({
      order,
      key: process.env.RAZORPAY_KEY_ID
    });

  } catch (err) {
    console.error("❌ CREATE ORDER ERROR:", err);
    res.status(500).json({ error: "Order creation failed" });
  }
});

/* ======================
   START SERVER
====================== */
app.listen(Number(process.env.PORT), "0.0.0.0", () => {
  console.log("✅ Backend running on", process.env.PORT);
});
