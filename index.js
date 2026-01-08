import express from "express";
import cors from "cors";
import Razorpay from "razorpay";
import crypto from "crypto";
import admin from "firebase-admin";

/* ======================
   APP SETUP
====================== */
const app = express();

app.use(cors({
  origin: [
    "https://gangasolvo.web.app",
    "https://gangasolvo.firebaseapp.com",
    "http://localhost:8080"
  ],
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"]
}));

app.use(express.json());

/* ======================
   ENV CHECK
====================== */
if (!process.env.PORT) throw new Error("PORT missing");
if (!process.env.RAZORPAY_KEY_ID) throw new Error("RAZORPAY_KEY_ID missing");
if (!process.env.RAZORPAY_KEY_SECRET) throw new Error("RAZORPAY_KEY_SECRET missing");
if (!process.env.FIREBASE_SERVICE_ACCOUNT) throw new Error("FIREBASE_SERVICE_ACCOUNT missing");

/* ======================
   FIREBASE ADMIN
====================== */
admin.initializeApp({
  credential: admin.credential.cert(
    JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
  ),
  databaseURL:
    "https://gangasolvo-default-rtdb.asia-southeast1.firebasedatabase.app"
});

/* ======================
   RAZORPAY
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

    const receipt = `c_${uid.slice(0, 6)}_${Date.now()}`;

    const order = await razorpay.orders.create({
      amount: Number(amount) * 100, // paise
      currency: "INR",
      receipt
    });

    res.json(order);

  } catch (err) {
    console.error("❌ CREATE ORDER ERROR:", err?.error || err);
    res.status(500).json({ error: "Order creation failed" });
  }
});

/* ======================
   VERIFY PAYMENT
====================== */
app.post("/verify-payment", async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      uid,
      courseId
    } = req.body;

    /* ---------- Basic validation ---------- */
    if (
      !razorpay_order_id ||
      !razorpay_payment_id ||
      !razorpay_signature ||
      !uid ||
      !courseId
    ) {
      return res.status(400).json({
        success: false,
        error: "Invalid payload"
      });
    }

    /* ---------- Signature verification ---------- */
    const body = `${razorpay_order_id}|${razorpay_payment_id}`;

    const expected = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest("hex");

    if (expected !== razorpay_signature) {
      return res.status(400).json({
        success: false,
        error: "Signature mismatch"
      });
    }

    /* ---------- Idempotency check ---------- */
    const courseRef = admin.database()
      .ref(`users/${uid}/courses/${courseId}`);

    const snapshot = await courseRef.get();

    if (snapshot.exists() && snapshot.val()?.paid === true) {
      return res.json({
        success: true,
        message: "Already verified"
      });
    }

    /* ---------- Mark course as paid ---------- */
    await courseRef.set({
      paid: true,
      paymentId: razorpay_payment_id,
      orderId: razorpay_order_id,
      verifiedAt: Date.now(),
      source: "razorpay_checkout"
    });

    return res.json({ success: true });

  } catch (err) {
    console.error("❌ VERIFY ERROR:", err);
    return res.status(500).json({
      success: false,
      error: "Internal verification error"
    });
  }
});


/* ======================
   START SERVER
====================== */
app.listen(Number(process.env.PORT), "0.0.0.0", () => {
  console.log("✅ Backend running on", process.env.PORT);
});
