import express from "express";
import cors from "cors";
import Razorpay from "razorpay";
import crypto from "crypto";
import admin from "firebase-admin";

const app = express();

/* ---------- CORS (FINAL) ---------- */
const corsOptions = {
  origin: [
    "http://localhost:8080",
    "https://gangasolvo.web.app",
    "https://gangasolvo.firebaseapp.com"
  ],
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"],
  optionsSuccessStatus: 204
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
app.use(express.json());

/* ---------- ENV CHECK ---------- */
if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  throw new Error("FIREBASE_SERVICE_ACCOUNT missing");
}
if (!process.env.RAZORPAY_KEY_ID) {
  throw new Error("RAZORPAY_KEY_ID missing");
}
if (!process.env.RAZORPAY_KEY_SECRET) {
  throw new Error("RAZORPAY_KEY_SECRET missing");
}

/* ---------- FIREBASE ADMIN (SAFE) ---------- */
let serviceAccount;
try {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
} catch (err) {
  console.error("❌ INVALID FIREBASE_SERVICE_ACCOUNT JSON");
  console.error(err);
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://gangasolvo-default-rtdb.asia-southeast1.firebasedatabase.app"
});

/* =========================
   RAZORPAY INIT
========================= */
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

/* =========================
   HEALTH CHECK (DEBUG)
========================= */
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

/* =========================
   CREATE ORDER
========================= */
app.post("/create-order", async (req, res) => {
  try {
    const { amount, uid, courseId } = req.body;

    if (!amount || !uid || !courseId) {
      return res.status(400).json({ error: "Invalid payload" });
    }

    const order = await razorpay.orders.create({
      amount: amount * 100, // 🔥 REQUIRED (paise)
      currency: "INR",
      receipt: `${uid}_${courseId}_${Date.now()}`
    });

    res.json(order);

  } catch (err) {
    console.error("❌ Razorpay create-order error:", err);
    res.status(500).json({ error: "Order creation failed" });
  }
});

/* =========================
   VERIFY PAYMENT
========================= */
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
    console.error("❌ Verify-payment error:", err);
    res.status(500).json({ success: false });
  }
});

/* =========================
   START SERVER
========================= */
const PORT = Number(process.env.PORT);

app.listen(PORT, "0.0.0.0", () => {
  console.log("✅ Server listening on", PORT);
});

