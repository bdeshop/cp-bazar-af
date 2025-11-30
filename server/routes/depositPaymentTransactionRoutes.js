// routes/depositTransaction.routes.js
import express from "express";
import DepositPaymentTransaction from "../models/DepositPaymentTransaction.js";
import DepositPaymentMethod from "../models/DepositPaymentMethod.js";
import Admin from "../models/Admin.js"; // তোমার ইউজার মডেল

const router = express.Router();

// ===============================================
// POST: Create Deposit Request (User Side)
// ===============================================
router.post("/deposit-transaction", async (req, res) => {
  try {
    const {
      paymentMethodId,
      userId,
      channel,
      amount,
      userInputs = [],
    } = req.body;

    if (!paymentMethodId || !amount || !userId) {
      return res.status(400).json({
        success: false,
        msg: "paymentMethodId, channel & amount required",
      });
    }

    const method = await DepositPaymentMethod.findById(paymentMethodId);
    if (!method || method.status !== "active") {
      return res.status(400).json({
        success: false,
        msg: "Invalid or inactive payment method",
      });
    }

    // চেক করো amount রেঞ্জে আছে কিনা
    if (amount < method.minAmount || amount > method.maxAmount) {
      return res.status(400).json({
        success: false,
        msg: `Amount must be between ${method.minAmount} - ${method.maxAmount} BDT`,
      });
    }

    const transaction = new DepositPaymentTransaction({
      userId,
      paymentMethodId,
      paymentMethod: {
        methodName: method.methodName,
        methodNameBD: method.methodNameBD,
        methodImage: method.methodImage,
        agentWalletNumber: method.agentWalletNumber,
        agentWalletText: method.agentWalletText || "agent",
      },
      channel,
      amount,
      userInputs,
      status: "pending",
    });

    await transaction.save();

    res.status(201).json({
      success: true,
      msg: "Deposit request created successfully",
      data: transaction,
    });
  } catch (err) {
    console.error("Create deposit error:", err);
    res
      .status(500)
      .json({ success: false, msg: "Server error", error: err.message });
  }
});

// ===============================================
// GET: All Deposit Transactions (Admin Panel)
// ===============================================
router.get("/deposit-transaction", async (req, res) => {
  try {
    const transactions = await DepositPaymentTransaction.find()
      .populate("userId", "username whatsapp email")
      .populate(
        "paymentMethodId",
        "methodName methodNameBD methodImage agentWalletNumber"
      )
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      count: transactions.length,
      data: transactions,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, msg: "Server error" });
  }
});

// ===============================================
// GET: Single Transaction Details
// ===============================================
router.get("/deposit-transaction/:id", async (req, res) => {
  try {
    const transaction = await DepositPaymentTransaction.findById(req.params.id)
      .populate("userId", "username whatsapp email")
      .populate("paymentMethodId", "methodName methodNameBD");

    if (!transaction) {
      return res
        .status(404)
        .json({ success: false, msg: "Transaction not found" });
    }

    res.json({ success: true, data: transaction });
  } catch (err) {
    res.status(500).json({ success: false, msg: "Server error" });
  }
});

// ===============================================
// PUT: Update Status (Approve / Reject / Cancel)
// ===============================================
// ===============================================
router.put("/deposit-transaction/:id", async (req, res) => {
  try {
    const { status, reason } = req.body;

    if (!["pending", "completed", "failed", "cancelled"].includes(status)) {
      return res.status(400).json({ success: false, msg: "Invalid status" });
    }

    if (["failed", "cancelled"].includes(status) && !reason?.trim()) {
      return res.status(400).json({
        success: false,
        msg: "Reason is required for failed or cancelled status",
      });
    }

    const transaction = await DepositPaymentTransaction.findByIdAndUpdate(
      req.params.id,
      { status, reason: reason?.trim() || "", updatedAt: Date.now() },
      { new: true, runValidators: true }
    );

    if (!transaction) {
      return res
        .status(404)
        .json({ success: false, msg: "Transaction not found" });
    }

    // শুধুমাত্র status completed হলে user এর balance যোগ হবে
    if (status === "completed") {
      await Admin.findByIdAndUpdate(transaction.userId, {
        $inc: { balance: transaction.amount },
      });
    }

    res.json({
      success: true,
      msg: "Transaction updated successfully",
      data: transaction,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, msg: "Server error" });
  }
});

// ===============================================
// DELETE: Delete Transaction (Admin)
// ===============================================
router.delete("/deposit-transaction/:id", async (req, res) => {
  try {
    const transaction = await DepositPaymentTransaction.findByIdAndDelete(
      req.params.id
    );

    if (!transaction) {
      return res
        .status(404)
        .json({ success: false, msg: "Transaction not found" });
    }

    res.json({ success: true, msg: "Transaction deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, msg: "Server error" });
  }
});

// ===============================================
// GET: Search Transactions (by phone, name, trxid)
// ===============================================
router.get("/deposit-search-transaction/search", async (req, res) => {
  try {
    const { query } = req.query;

    if (!query || query.trim() === "") {
      return res
        .status(400)
        .json({ success: false, msg: "Search query required" });
    }

    const transactions = await DepositPaymentTransaction.find({
      $or: [
        { "userInputs.value": { $regex: query, $options: "i" } }, // TrxID
        { "userId.phoneNumber": { $regex: query, $options: "i" } },
        { "userId.name": { $regex: query, $options: "i" } },
      ],
    })
      .populate("userId", "name phoneNumber")
      .populate("paymentMethodId", "methodName")
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      count: transactions.length,
      data: transactions,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, msg: "Search error" });
  }
});

export default router;
