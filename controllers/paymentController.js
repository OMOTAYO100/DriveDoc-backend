const axios = require('axios');
const Payment = require('../models/Payment');
const Document = require('../models/Documents');

// @desc    Verify Paystack Payment
// @route   POST /api/payments/verify
// @access  Private
exports.verifyPayment = async (req, res) => {
    try {
        const { reference, documentId } = req.body;
        console.log(`[Payment] Verify Request - Ref: ${reference}, Doc: ${documentId}`);

        // Verify with Paystack
        const secretKey = process.env.PAYSTACK_SECRET_KEY;
        if (!secretKey) {
             console.error("[Payment] Missing PAYSTACK_SECRET_KEY");
             throw new Error('Paystack secret key not configured');
        }

        const paystackRes = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
            headers: { Authorization: `Bearer ${secretKey}` }
        });

        const data = paystackRes.data.data;

        if (data.status !== 'success') {
             return res.status(400).json({ success: false, message: 'Payment verification failed' });
        }

        // Check if we already recorded this
        const existingPayment = await Payment.findOne({ paystackReference: reference });
        if (existingPayment) {
            return res.status(200).json({ success: true, message: 'Already processed' });
        }

        // Record payment
        await Payment.create({
            user: req.user.id,
            document: documentId,
            amount: data.amount,
            currency: data.currency,
            paystackReference: reference,
            paystackTransactionId: String(data.id),
            status: 'success'
        });

        // Update Document Expiry (Add 1 year)
        const document = await Document.findById(documentId);
        if (!document) return res.status(404).json({ success: false, message: 'Document not found' });

        const oldDate = new Date(document.expiryDate);
        const now = new Date();
        let newDate;
        
        // Logic: if expired, 1 year from now. If valid, 1 year from current expiry.
        if (oldDate < now) {
            newDate = new Date(now.setFullYear(now.getFullYear() + 1));
        } else {
             newDate = new Date(oldDate.setFullYear(oldDate.getFullYear() + 1));
        }

        document.expiryDate = newDate;
        document.status = 'valid'; 
        await document.save();

        res.status(200).json({
            success: true,
            document
        });

    } catch (err) {
        console.error(err);
         res.status(500).json({ success: false, message: 'Verification failed' });
    }
};
