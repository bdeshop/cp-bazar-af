// routes/withdrawTransaction.routes.js
import express from "express";
import WithdrawPaymentTransaction from "../models/WithdrawPaymentTransaction.js";
import WithdrawPaymentMethod from "../models/WithdrawPaymentMethod.js";
import Admin from "../models/Admin.js";

const router = express.Router();

// ==================== USER: Submit Withdraw Request ====================
router.post("/request", async (req, res) => {
  try {
    const { userId, paymentMethodId, channel, amount, userInputs } = req.body;

    // Validation
    if (!userId || !paymentMethodId || !channel || !amount || !userInputs) {
      return res
        .status(400)
        .json({ success: false, msg: "All fields are required" });
    }

    if (amount < 200 || amount > 30000) {
      return res
        .status(400)
        .json({ success: false, msg: "Amount must be between 200 and 30000" });
    }

    const user = await Admin.findById(userId);
    if (!user)
      return res.status(404).json({ success: false, msg: "User not found" });

    const method = await WithdrawPaymentMethod.findById(paymentMethodId);
    if (!method || method.status !== "active") {
      return res
        .status(404)
        .json({ success: false, msg: "Payment method not available" });
    }

    // Check balance
    if (user.balance < amount) {
      return res
        .status(400)
        .json({ success: false, msg: "Insufficient balance" });
    }

    // Deduct balance immediately (এটাই সবচেয়ে সেফ)
    user.balance -= amount;
    await user.save();

    // Create transaction
    const transaction = new WithdrawPaymentTransaction({
      userId,
      paymentMethod: {
        methodName: method.methodName,
        methodNameBD: method.methodNameBD,
        methodImage: method.methodImage,
        gateway: channel,
      },
      channel,
      amount,
      userInputs,
      status: "pending",
    });

    await transaction.save();

    res.status(201).json({
      success: true,
      msg: "Withdraw request submitted successfully",
      data: transaction,
    });
  } catch (err) {
    console.error("Withdraw Request Error:", err);
    res.status(500).json({ success: false, msg: "Server error" });
  }
});

// ==================== ADMIN: Get All Withdraw Transactions (with pagination) ====================
router.get("/", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const transactions = await WithdrawPaymentTransaction.find()
      .populate({
        path: "userId",
        select: "username whatsapp email balance",
      })
      .populate({
        path: "paymentMethod",
        select: "methodName gateway methodImage",
      })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await WithdrawPaymentTransaction.countDocuments();

    res.json({
      success: true,
      data: transactions,
      pagination: {
        current: page,
        pages: Math.ceil(total / limit),
        total,
      },
    });
  } catch (err) {
    console.error("Get All Withdraw Transactions Error:", err);
    res.status(500).json({ success: false, msg: "Server error" });
  }
});

// ==================== ADMIN: Get Single Withdraw Transaction ====================
router.get("/:id", async (req, res) => {
  try {
    const transaction = await WithdrawPaymentTransaction.findById(req.params.id)
      .populate({
        path: "userId",
        select: "username whatsapp email balance",
      })
      .populate({
        path: "paymentMethod",
        select: "methodName gateway methodImage",
      });

    if (!transaction) {
      return res.status(404).json({
        success: false,
        msg: "Transaction not found",
      });
    }

    res.json({
      success: true,
      data: transaction,
    });
  } catch (err) {
    console.error("Get Single Transaction Error:", err);
    res.status(500).json({ success: false, msg: "Server error" });
  }
});

// ==================== ADMIN: Update Transaction Status (Accept / Cancel / Reject) ====================
router.put("/:id", async (req, res) => {
  try {
    const { status, reason } = req.body;

    // Valid status check
    if (!["completed", "cancelled", "failed"].includes(status)) {
      return res.status(400).json({
        success: false,
        msg: "Invalid status. Allowed: 'completed', 'cancelled', 'failed'",
      });
    }

    // Reason required for cancel or reject
    if ((status === "cancelled" || status === "failed") && !reason?.trim()) {
      return res.status(400).json({
        success: false,
        msg: "Reason is required when cancelling or rejecting",
      });
    }

    // Find transaction with populated user
    const transaction = await WithdrawPaymentTransaction.findById(
      req.params.id
    ).populate("userId", "name phoneNumber balance");

    if (!transaction) {
      return res.status(404).json({
        success: false,
        msg: "Transaction not found",
      });
    }

    // Only pending transactions can be updated
    if (transaction.status !== "pending") {
      return res.status(400).json({
        success: false,
        msg: `Transaction is already ${transaction.status}. Cannot modify.`,
      });
    }

    const user = transaction.userId;
    if (!user) {
      return res.status(404).json({
        success: false,
        msg: "User not found for this transaction",
      });
    }

    // // Main Logic: Balance Handling
    // if (status === "completed") {
    //   // Permanently deduct money from user's balance
    //   if (user.balance < transaction.amount) {
    //     return res.status(400).json({
    //       success: false,
    //       msg: `Insufficient balance. User has ৳${user.balance}, needs ৳${transaction.amount}`,
    //     });
    //   }
    //   user.balance -= transaction.amount;
    // }

    // Refund money if cancelled or failed
    if (status === "cancelled" || status === "failed") {
      user.balance += transaction.amount; // Return full amount
    }

    // Save updated balance
    await user.save();

    // Update transaction status & reason
    transaction.status = status;
    if (reason) transaction.reason = reason.trim();
    transaction.processedAt = Date.now(); // Optional: track when it was processed
    transaction.updatedAt = Date.now();
    await transaction.save();

    // Success response
    res.json({
      success: true,
      msg:
        status === "completed"
          ? "Withdrawal completed – amount deducted permanently"
          : `Withdrawal ${
              status === "cancelled" ? "cancelled" : "rejected"
            } – amount refunded`,
      data: {
        transaction,
        userBalanceAfter: user.balance,
        action: status,
      },
    });
  } catch (err) {
    console.error("Update Withdraw Transaction Error:", err);
    res.status(500).json({ success: false, msg: "Server error" });
  }
});

// ==================== ADMIN: Delete Single Withdraw Transaction (Permanent Delete) ====================
router.delete("/:id", async (req, res) => {
  try {
    const transactionId = req.params.id;

    const transaction = await WithdrawPaymentTransaction.findById(
      transactionId
    ).populate("userId", "name phoneNumber balance");

    if (!transaction) {
      return res.status(404).json({
        success: false,
        msg: "Transaction not found or already deleted",
      });
    }

    // Prevent deleting completed transactions
    if (transaction.status === "completed") {
      return res.status(400).json({
        success: false,
        msg: "Cannot delete completed withdrawal transaction",
      });
    }

    // Refund money if it was pending (so user doesn't lose money on delete)
    if (transaction.status === "pending" && transaction.userId) {
      transaction.userId.balance += transaction.amount;
      await transaction.userId.save();
    }

    // Permanently delete
    await WithdrawPaymentTransaction.findByIdAndDelete(transactionId);

    res.json({
      success: true,
      msg: "Transaction deleted permanently",
      refunded: transaction.status === "pending" ? transaction.amount : 0,
      user: transaction.userId
        ? {
            name: transaction.userId.name,
            phone: transaction.userId.phoneNumber,
          }
        : null,
    });
  } catch (err) {
    console.error("Delete Transaction Error:", err);
    res.status(500).json({ success: false, msg: "Server error" });
  }
});

export default router;
