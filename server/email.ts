import nodemailer from "nodemailer";
import sgMail from '@sendgrid/mail';

// Setup SendGrid with API key if available
if (process.env.SENDGRID_API_KEY) {
  console.log("Using SendGrid for email delivery");
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
} else {
  console.log("SENDGRID_API_KEY not found, falling back to nodemailer transport");
}

// Initialize email transporter as fallback
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || "smtp.ethereal.email",
  port: parseInt(process.env.EMAIL_PORT || "587"),
  secure: process.env.EMAIL_SECURE === "true",
  auth: {
    user: process.env.EMAIL_USER || "ethereal.user@ethereal.email",
    pass: process.env.EMAIL_PASS || "ethereal_pass",
  },
});

interface SendEmailOptions {
  recipientEmail: string;
  amount: string;
  note?: string;
  senderAddress: string;
  claimToken: string;
  appDomain: string;
}

export async function sendClaimEmail({
  recipientEmail,
  amount,
  note,
  senderAddress,
  claimToken,
  appDomain,
}: SendEmailOptions): Promise<boolean> {
  try {
    // Truncate the sender address for display in the email
    const truncatedAddress = `${senderAddress.slice(0, 6)}...${senderAddress.slice(-4)}`;
    
    // Create claim URL
    const claimUrl = `${appDomain}/claim/${claimToken}`;
    
    // Email content
    // Use the verified sender email address
    const emailFrom = process.env.EMAIL_FROM || "planeify.business@gmail.com";
    const emailSubject = `You've received ${amount} USDC on Algorand!`;
    const emailText = `
      Hello,
      
      You've received ${amount} USDC from ${truncatedAddress} on the Algorand blockchain.
      
      ${note ? `Message from sender: "${note}"` : ""}
      
      To claim your USDC, click the link below:
      ${claimUrl}
      
      This link will expire in 30 days. You'll need to connect your Algorand wallet (Pera or Defly) to claim your funds.
      
      If you're new to Algorand, you can download a wallet app:
      - Pera Wallet: https://perawallet.app/
      - Defly Wallet: https://defly.app/
      
      Thank you for using AlgoSend!
    `;
    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 10px;">
        <div style="background: linear-gradient(45deg, #00AC6B, #3CC8C8); padding: 15px; border-radius: 8px 8px 0 0; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 22px;">You've received USDC!</h1>
        </div>
        
        <div style="padding: 20px;">
          <p style="font-size: 16px;">Hello,</p>
          
          <p style="font-size: 16px;">
            You've received <strong>${amount} USDC</strong> from <span style="font-family: monospace;">${truncatedAddress}</span> on the Algorand blockchain.
          </p>
          
          ${note ? `<p style="font-size: 16px; padding: 10px; background-color: #f8fafc; border-radius: 6px; border-left: 4px solid #00AC6B;"><strong>Message from sender:</strong> "${note}"</p>` : ""}
          
          <div style="margin: 30px 0; text-align: center;">
            <a href="${claimUrl}" style="background: linear-gradient(45deg, #00AC6B, #3CC8C8); color: white; padding: 12px 25px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">Claim Your USDC</a>
          </div>
          
          <p style="font-size: 14px; color: #64748b;">
            This link will expire in 30 days. You'll need to connect your Algorand wallet (Pera or Defly) to claim your funds.
          </p>
          
          <p style="font-size: 14px; color: #64748b;">
            If you're new to Algorand, you can download a wallet app:
            <br>- <a href="https://perawallet.app/" style="color: #00AC6B;">Pera Wallet</a>
            <br>- <a href="https://defly.app/" style="color: #00AC6B;">Defly Wallet</a>
          </p>
        </div>
        
        <div style="background-color: #f8fafc; padding: 15px; border-radius: 0 0 8px 8px; text-align: center; font-size: 12px; color: #64748b;">
          <p>Thank you for using AlgoSend!</p>
        </div>
      </div>
    `;
    
    // Try to send using SendGrid if API key is available
    if (process.env.SENDGRID_API_KEY) {
      try {
        const msg = {
          to: recipientEmail,
          from: emailFrom,
          subject: emailSubject,
          text: emailText,
          html: emailHtml,
        };
        await sgMail.send(msg);
        console.log(`Email sent to ${recipientEmail} using SendGrid`);
      } catch (sgError) {
        console.error("SendGrid error:", sgError);
        console.log("Falling back to nodemailer...");
        
        // Fall back to nodemailer transport
        const mailOptions = {
          from: emailFrom,
          to: recipientEmail,
          subject: emailSubject,
          text: emailText,
          html: emailHtml,
        };
        await transporter.sendMail(mailOptions);
        console.log(`Email sent to ${recipientEmail} using nodemailer transport`);
      }
    } else {
      // Use nodemailer transport if no SendGrid API key
      const mailOptions = {
        from: emailFrom,
        to: recipientEmail,
        subject: emailSubject,
        text: emailText,
        html: emailHtml,
      };
      await transporter.sendMail(mailOptions);
      console.log(`Email sent to ${recipientEmail} using nodemailer transport`);
    }
    
    return true;
  } catch (error) {
    console.error("Error sending email:", error);
    return false;
  }
}
