// routes/depositTransaction.routes.js
import express from "express";
import DepositPaymentTransaction from "../models/DepositPaymentTransaction.js";
import DepositPaymentMethod from "../models/DepositPaymentMethod.js";
import Admin from "../models/Admin.js"; // তোমার ইউজার মডেল
import DepositBonus from "../models/DepositBonus.js";

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
router.put("/deposit-transaction/:id", async (req, res) => {
  try {
    const { status, reason } = req.body;

    if (!["pending", "completed", "failed", "cancelled"].includes(status)) {
      return res.status(400).json({ success: false, msg: "Invalid status" });
    }

    if (["failed", "cancelled"].includes(status) && !reason?.trim()) {
      return res.status(400).json({ success: false, msg: "Reason required" });
    }

    // paymentMethodId populate করছি (তোমার মডেল অনুযায়ী)
    const transaction = await DepositPaymentTransaction.findById(req.params.id)
      .populate("userId", "username balance referredBy depositCommission depositCommissionBalance")
      .populate("paymentMethodId");

    if (!transaction) {
      return res.status(404).json({ success: false, msg: "Transaction not found" });
    }

    const wasPending = transaction.status === "pending";
    const isNowCompleted = status === "completed";

    // ট্রানজেকশন স্ট্যাটাস আপডেট
    await DepositPaymentTransaction.findByIdAndUpdate(
      req.params.id,
      {
        status,
        reason: reason?.trim() || "",
        updatedAt: Date.now(),
      },
      { new: true }
    );

    // শুধু pending → completed হলে সবকিছু যোগ হবে
    if (isNowCompleted && wasPending) {
      const depositAmount = transaction.amount;
      const user = transaction.userId;
      const userId = user._id;

      // ১. ইউজারের মেইন ব্যালেন্সে ডিপোজিট যোগ
      await Admin.findByIdAndUpdate(userId, { $inc: { balance: depositAmount } });

      let bonusAmount = 0;

      // ২. ডিপোজিট বোনাস (৮%)
      try {
        if (transaction.paymentMethodId?._id) {
          const paymentMethodObjId = transaction.paymentMethodId._id;

          const bonusConfig = await DepositBonus.findOne({
            payment_methods: paymentMethodObjId,
          });

          if (bonusConfig) {
            const bonusEntry = bonusConfig.promotion_bonuses.find(
              (b) => b.payment_method.toString() === paymentMethodObjId.toString()
            );

            if (bonusEntry && bonusEntry.bonus > 0) {
              bonusAmount = bonusEntry.bonus_type === "Percentage"
                ? depositAmount * (bonusEntry.bonus / 100)
                : bonusEntry.bonus;

              if (bonusAmount > 0) {
                await Admin.findByIdAndUpdate(userId, { $inc: { balance: bonusAmount } });

                await DepositPaymentTransaction.findByIdAndUpdate(transaction._id, {
                  $set: {
                    bonusApplied: bonusAmount,
                    bonusType: bonusEntry.bonus_type,
                    bonusValue: bonusEntry.bonus,
                  },
                });

                console.log(`DEPOSIT BONUS +৳${bonusAmount.toFixed(2)} (${bonusEntry.bonus}%) → ${user.username}`);
              }
            }
          }
        }
      } catch (err) {
        console.error("Bonus error:", err.message);
      }

      // ৩. এফিলিয়েট ডিপোজিট কমিশন (মাল্টি-লেভেল)
      if (user.referredBy) {
        const master = await Admin.findById(user.referredBy);

        if (master && master.depositCommission > 0) {
          const masterRate = master.depositCommission / 100;
          const masterCommission = depositAmount * masterRate;

          if (masterCommission > 0) {
            await Admin.findByIdAndUpdate(master._id, {
              $inc: { depositCommissionBalance: masterCommission },
            });
            console.log(`Master Commission: +৳${masterCommission.toFixed(2)} → ${master.username}`);
          }

          // Super Affiliate (যদি Master কে কেউ রেফার করে থাকে)
          if (master.referredBy) {
            const superAff = await Admin.findById(master.referredBy);

            if (
              superAff &&
              superAff.role === "super-affiliate" &&
              superAff.depositCommission > master.depositCommission
            ) {
              const superRate = superAff.depositCommission / 100;
              const totalSuperCommission = depositAmount * superRate;
              const superBonus = totalSuperCommission - masterCommission;

              if (superBonus > 0) {
                await Admin.findByIdAndUpdate(superAff._id, {
                  $inc: { depositCommissionBalance: superBonus },
                });
                console.log(`Super Affiliate Bonus: +৳${superBonus.toFixed(2)} → ${superAff.username}`);
              }
            }
          }
        }
      }

      // ফাইনাল লগ
      console.log(
        `DEPOSIT SUCCESS → ${user.username} | Deposit: ৳${depositAmount} | Bonus: ৳${bonusAmount.toFixed(2)} | Total Credit: ৳${(depositAmount + bonusAmount).toFixed(2)}`
      );
    }

    res.json({ success: true, msg: "Transaction updated successfully" });

  } catch (err) {
    console.error("Deposit transaction error:", err);
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
