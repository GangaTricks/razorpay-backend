import express from "express";
import cors from "cors";
import Razorpay from "razorpay";
import crypto from "crypto";
import admin from "firebase-admin";

/* ======================================================
   BASIC APP SETUP
====================================================== */
const app = express();

app.use(cors({
  origin: [
    "http://localhost:8080",
    "https://gangasolvo.web.app",
    "https://gangasolvo.firebaseapp.com"
  ],
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"]
}));

app.use(express.json());

/* ======================================================
   ENV VALIDATION (FAIL FAST)
====================================================== */
if (!process.env.PORT) {
  throw new Error("❌ PORT missing");
}
if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  throw new Error("❌ FIREBASE_SERVICE_ACCOUNT missing");
}
if (!process.env.RAZORPAY_KEY_ID) {
  throw new Error("❌ RAZORPAY_KEY_ID missing");
}
if (!process.env.RAZORPAY_KEY_SECRET) {
  throw new Error("❌ RAZORPAY_KEY_SECRET missing");
}

/* ======================================================
   FIREBASE ADMIN INIT
====================================================== */
let serviceAccount;
try {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
} catch (e) {
  console.error("❌ FIREBASE_SERVICE_ACCOUNT is invalid JSON");
  throw e;
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL:
    "https://gangasolvo-default-rtdb.asia-southeast1.firebasedatabase.app"
});

/* ======================================================
   RAZORPAY INIT (TEST MODE)
====================================================== */
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID.trim(),
  key_secret: process.env.RAZORPAY_KEY_SECRET.trim()
});

/* ======================================================
   HEALTH CHECK
====================================================== */
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

/* ======================================================
   DEBUG: RAZORPAY ISOLATION TEST
   (REMOVE AFTER SUCCESS)
====================================================== */
app.get("/debug-razorpay", async (req, res) => {
  try {
    const order = await razorpay.orders.create({
      amount: 1000,
      currency: "INR",
      receipt: "debug_test"
    });
    res.json(order);
  } catch (err) {
    console.error("❌ DEBUG RAZORPAY ERROR");
    console.error("message:", err?.message);
    console.error("statusCode:", err?.statusCode);
    console.error("error:", err?.error);
    res.status(500).json(err);
  }
});

/* ======================================================
   CREATE ORDER
====================================================== */
app.post("/create-order", async (req, res) => {
  try {
    const { amount, uid, courseId } = req.body;

    if (!amount || !uid || !courseId) {
      return res.status(400).json({ error: "Invalid payload" });
    }

    const order = await razorpay.orders.create({
      amount: amount * 100, // paise
      currency: "INR",
      receipt: `${uid}_${courseId}_${Date.now()}`
    });

    res.json(order);

  } catch (err) {
    console.error("❌ RAZORPAY CREATE-ORDER FAILED");
    console.error("message:", err?.message);
    console.error("statusCode:", err?.statusCode);
    console.error("error:", err?.error);
    console.error("raw:", JSON.stringify(err, null, 2));

    res.status(500).json({
      error: "Order creation failed",
      details: err?.error || err?.message
    });
  }
});

/* ======================================================
   VERIFY PAYMENT
====================================================== */
app.post("/verify-payment", async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      uid,
      courseId
    } = req.body;

    const body =
      razorpay_order_id + "|" + razorpay_payment_id;

    const expected = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest("hex");

    if (expected !== razorpay_signature) {
      return res.status(400).json({ success: false });
    }

    await admin.database()
      .ref(`users/${uid}/courses/${courseId}`)
      .set({
        paid: true,
        paymentId: razorpay_payment_id,
        time: Date.now()
      });

    res.json({ success: true });

  } catch (err) {
    console.error("❌ VERIFY PAYMENT ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* ======================================================
   START SERVER
====================================================== */
app.listen(Number(process.env.PORT), "0.0.0.0", () => {
  console.log("✅ Server listening on", process.env.PORT);
});
