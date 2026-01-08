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
if (!process.env.FIREBASE_SERVICE_ACCOUNT_BASE64)
  throw new Error("FIREBASE_SERVICE_ACCOUNT_BASE64 missing");

/* ======================
   FIREBASE ADMIN (BASE64 SAFE)
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
   RAZORPAY
====================== */
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID.trim(),
  key_secret: process.env.RAZORPAY_KEY_SECRET.trim()
});

/* ======================
   HEALTH CHECK
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
      amount: Number(amount) * 100, // paise
      currency: "INR",
      receipt: `course_${Date.now()}`
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

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ success: false });
    }

    const body = `${razorpay_order_id}|${razorpay_payment_id}`;
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({ success: false });
    }

    const ref = admin.database()
      .ref(`users/${uid}/courses/${courseId}`);

    const snap = await ref.get();
    if (snap.exists()) {
      return res.json({ success: true }); // already verified
    }

    await ref.set({
      paid: true,
      orderId: razorpay_order_id,
      paymentId: razorpay_payment_id,
      verifiedAt: Date.now(),
      source: "razorpay_standard_checkout"
    });

    res.json({ success: true });

  } catch (err) {
    console.error("VERIFY ERROR:", err);
    res.status(500).json({ success: false });
  }
});


/* ======================
   START SERVER
====================== */
app.listen(Number(process.env.PORT), "0.0.0.0", () => {
  console.log("✅ Backend running on", process.env.PORT);
});
