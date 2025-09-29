import { json } from "@remix-run/node";
import { randomUUID } from "node:crypto";
import { useLoaderData, useFetcher } from "@remix-run/react";
import React from "react";
import { Page, Layout, Card, Text, BlockStack, TextField, Button, InlineStack, Link, Banner, Divider, InlineGrid } from "@shopify/polaris";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import nodemailer from "nodemailer";

// Email sending using Nodemailer + SMTP
async function sendEmail(to, subject, message, fromShop, htmlMessage = null) {
  try {
    const smtpHost = process.env.SMTP_HOST;
    const smtpPort = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : undefined;
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    const smtpFrom = process.env.SMTP_FROM || smtpUser;

    if (!smtpHost || !smtpPort || !smtpUser || !smtpPass) {
      console.warn("⚠️ SMTP env vars are not fully set (SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS). No real email will be sent.");
      console.log("📧 SUPPORT MESSAGE EMAIL (SIMULATED):");
      console.log("To:", to);
      console.log("Subject:", `Bundle App Support: ${subject}`);
      console.log("Shop:", fromShop);
      console.log("Message:", message);
      console.log("Timestamp:", new Date().toISOString());
      console.log("---");
      return true;
    }

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465, // true for 465, false for other ports (e.g., 587)
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    });

    const info = await transporter.sendMail({
      from: smtpFrom,
      to: to,
      subject: `Bundle App Support: ${subject}`,
      text: htmlMessage ? undefined : `New support message from ${fromShop}:\n\n${message}`,
      html: htmlMessage || `<p>New support message from <strong>${fromShop}</strong>:</p><pre>${message}</pre>`,
    });

    if (info?.messageId) {
      console.log(`📨 SMTP accepted message. messageId=${info.messageId}`);
    } else {
      console.log("📨 SMTP sendMail completed (no messageId returned)");
    }
    return true;
  } catch (error) {
    console.error("Failed to send email:", error);
    return false;
  }
}

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  const admin = await prisma.adminConfig.findUnique({ where: { id: "app-admin" } }).catch(() => null);
  return json({
    whatsappNumber: admin?.whatsappNumber || null,
    email: admin?.email || null,
  });
};

export const action = async ({ request }) => {
  try {
    const { session } = await authenticate.admin(request);
    const form = await request.formData();
    const message = form.get("message");
    const shop = session?.shop || "unknown";

    if (!message || String(message).trim().length === 0) {
      return json({ error: "Message is required" }, { status: 400 });
    }

    const trimmed = String(message).trim();

    // Store in database
    if (prisma.supportMessage && typeof prisma.supportMessage.create === "function") {
      await prisma.supportMessage.create({
        data: {
          shop,
          message: trimmed,
          status: "NEW",
        },
      });
    } else {
      // Fallback for environments where the Prisma client wasn't regenerated yet
      await prisma.$executeRaw`
        INSERT INTO SupportMessage (id, shop, message, status, createdAt, updatedAt)
        VALUES (${randomUUID()}, ${shop}, ${trimmed}, 'NEW', ${new Date().toISOString()}, ${new Date().toISOString()})
      `;
    }
    console.log(`Support message stored for ${shop}`);

    // Get admin email and send email notification
    const admin = await prisma.adminConfig.findUnique({ where: { id: "app-admin" } }).catch(() => null);
    const adminEmail = admin?.email;
    
    if (adminEmail) {
      const emailSent = await sendEmail(
        adminEmail,
        "New Support Message",
        `New support message from ${shop}:\n\n${trimmed}`,
        shop
      );
      
      if (emailSent) {
        console.log(`📧 Email notification sent to ${adminEmail}`);
      } else {
        console.log(`❌ Failed to send email to ${adminEmail}`);
      }
    } else {
      console.log("⚠️ No admin email configured - message stored but no email sent");
    }

    return json({ success: true });
  } catch (err) {
    console.error("Support action failed:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return json({ error: message }, { status: 500 });
  }
};

export default function Support() {
  const { whatsappNumber, email } = useLoaderData();
  const [message, setMessage] = React.useState("");
  const fetcher = useFetcher();
  const isSubmitting = fetcher.state === "submitting";

  const sendMail = () => {
    if (!email) return;
    const subject = encodeURIComponent("Bundle App Support Request");
    const body = encodeURIComponent(message || "Hi, I need help with Bundle App.");
    window.open(`mailto:${email}?subject=${subject}&body=${body}`, "_blank");
  };

  const openWhatsApp = () => {
    if (!whatsappNumber) return;
    const text = encodeURIComponent(message || "Hi, I need help with Bundle App.");
    const digits = String(whatsappNumber).replace(/[^\d]/g, "");
    const url = `https://wa.me/${digits}?text=${text}`;
    console.log("Opening WhatsApp URL:", url);
    window.open(url, "_blank");
  };

  const sendMessage = () => {
    if (!message.trim()) return;
    fetcher.submit({ message }, { method: "POST" });
    setMessage("");
  };

  return (
    <Page title="Contact Support" subtitle="Get help with Bundle App">
      <Layout>
        <Layout.Section>
          {!whatsappNumber && !email ? (
            <Banner tone="warning" title="Support contacts not configured">
              <p>Please configure APP_WHATSAPP_NUMBER or APP_CONTACT_EMAIL in your environment.</p>
            </Banner>
          ) : null}
          
          <InlineGrid columns={{ xs: 1, sm: 2 }} gap="400">
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Send us a message</Text>
                <Text as="p" variant="bodyMd" tone="subdued">
                  Describe your issue or question and we'll get back to you within 24 hours.
                </Text>
                
                <fetcher.Form method="post">
                  <BlockStack gap="300">
                    <TextField 
                      label="Your message" 
                      value={message} 
                      onChange={setMessage} 
                      name="message"
                      multiline 
                      rows={4}
                      autoComplete="off"
                      placeholder="Tell us how we can help you..."
                    />
                    <Button 
                      submit 
                      variant="primary" 
                      loading={isSubmitting}
                      disabled={!message.trim()}
                    >
                      Send Message
                    </Button>
                  </BlockStack>
                </fetcher.Form>

                {fetcher.data?.success && (
                  <Banner tone="success" title="Message sent!">
                    <p>We've received your message and will get back to you soon.</p>
                  </Banner>
                )}

                {fetcher.data?.error && (
                  <Banner tone="critical" title="Error">
                    <p>{fetcher.data.error}</p>
                  </Banner>
                )}
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Direct contact</Text>
                <Text as="p" variant="bodyMd" tone="subdued">
                  Prefer to reach out directly? Use these contact methods.
                </Text>
                
                <Divider />
                
                <BlockStack gap="300">
                  {whatsappNumber && (
                    <InlineStack align="space-between">
                      <Text as="span" variant="bodyMd">WhatsApp</Text>
                      <Button onClick={openWhatsApp} variant="tertiary" size="slim">
                        💬 Chat now
                      </Button>
                    </InlineStack>
                  )}
                  
                  {email && (
                    <InlineStack align="space-between">
                      <Text as="span" variant="bodyMd">Email</Text>
                      <Button onClick={sendMail} variant="tertiary" size="slim">
                        📧 Send email
                      </Button>
                    </InlineStack>
                  )}
                </BlockStack>

                <Divider />
                
                <BlockStack gap="200">
                  <Text as="h3" variant="headingSm">Response time</Text>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    • WhatsApp: Usually within 2-4 hours<br/>
                    • Email: Within 24 hours<br/>
                    • Business hours: 9 AM - 6 PM EST
                  </Text>
                </BlockStack>
              </BlockStack>
            </Card>
          </InlineGrid>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
