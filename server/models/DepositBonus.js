// models/DepositBonus.js
import mongoose from "mongoose";

const depositBonusSchema = new mongoose.Schema(
  {
    payment_methods: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "DepositPaymentMethod",
        required: true,
      },
    ],
    promotion_bonuses: [
      {
        payment_method: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "DepositPaymentMethod",
          required: true,
        },
        bonus_type: {
          type: String,
          enum: ["Fix", "Percentage"],
          default: "Fix",
        },
        bonus: {
          type: Number,
          default: 0,
          min: 0,
        },
      },
    ],
  },
  { timestamps: true }
);

// Export করার ২টা উপায় — দুটোই কাজ করবে
export const DepositBonus = mongoose.model("DepositBonus", depositBonusSchema);
export default DepositBonus;