// app/routes/webhooks.js

import { authenticate } from "../shopify.server";
import db from "../db.server";
import axios from "axios";

// This loader function handles any GET requests to this endpoint.
export const loader = async () => {
  throw new Response("Not Found", { status: 404 });
};

const sendWhatsAppMessage = async (settings, to, templateName, components) => {
  const { phoneId, accessToken } = settings;
  const cleanPhoneNumber = to.replace(/[^0-9]/g, "");
  const url = `https://graph.facebook.com/v20.0/${phoneId}/messages`;

  const data = {
    messaging_product: "whatsapp",
    to: cleanPhoneNumber,
    type: "template",
    template: {
      name: templateName,
      language: { code: "en_US" },
      components: [{ type: "body", parameters: components }],
    },
  };

  console.log(`[LOG] Preparing to send message to ${cleanPhoneNumber} using template '${templateName}'.`);
  // For deep debugging, uncomment the next line to see the exact data sent to Meta
  // console.log("[LOG] WhatsApp API Payload:", JSON.stringify(data, null, 2));

  try {
    await axios.post(url, data, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    console.log(`✅ [SUCCESS] Message sent successfully to ${to}.`);
  } catch (error) {
    console.error("❌ [ERROR] Failed to send WhatsApp message.");
    if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      console.error("[ERROR] Response Data:", JSON.stringify(error.response.data, null, 2));
      console.error("[ERROR] Response Status:", error.response.status);
    } else if (error.request) {
      // The request was made but no response was received
      console.error("[ERROR] No response received:", error.request);
    } else {
      // Something happened in setting up the request that triggered an Error
      console.error("[ERROR] Axios setup error:", error.message);
    }
  }
};

export const action = async ({ request }) => {
  // Use a try...catch block to handle any errors during webhook processing
  try {
    const { topic, shop, admin, payload } = await authenticate.webhook(request);

    if (!shop) {
      console.error("❌ [ERROR] Webhook authenticated but no shop was found. Aborting.");
      // A 404 response is appropriate here as the shop context is missing.
      return new Response("Webhook authenticated but no shop found.", { status: 404 });
    }

    // This log confirms that the webhook was received and authenticated successfully.
    console.log(`\n---`);
    console.log(`[LOG] Webhook received. Topic: ${topic}, Shop: ${shop}`);

    // Fetch the settings from the database for the specific shop.
    const settings = await db.whatsAppSettings.findUnique({ where: { shop } });

    // Check for settings only inside the cases that need them.
    // This allows webhooks like APP_UNINSTALLED to work even if settings were never saved.
    switch (topic) {
      case "APP_UNINSTALLED":
        console.log(`[LOG] App was uninstalled for ${shop}. No action needed.`);
        break;

      case "ORDERS_CREATE":
        if (!settings || !settings.phoneId || !settings.accessToken) {
          console.log(`⚠️ [SKIP] Skipping ORDERS_CREATE because settings are incomplete for ${shop}.`);
          break; // Exit this case
        }
        const order = payload;
        console.log(`[LOG] Processing ORDERS_CREATE for order #${order.name}`);
        const customerPhoneOrder = order.customer?.phone || order.phone;
        const productTitles = order.line_items.map(item => item.title).join(', ');
        
        if (customerPhoneOrder && settings.confirmationTemplate) {
          await sendWhatsAppMessage(settings, customerPhoneOrder, settings.confirmationTemplate, [
            { type: "text", text: order.customer?.first_name || "Valued Customer" },
            { type: "text", text: order.name },
            {
              type: "currency",
              currency: {
                fallback_value: `${order.total_price} ${order.currency}`,
                code: order.currency,
                amount_1000: Math.round(parseFloat(order.total_price) * 1000),
              },
            },
            { type: "text", text: productTitles },
          ]);
        } else {
          console.log("⚠️ [SKIP] Order created, but no customer phone or confirmation template found in settings.");
        }
        break;

      case "FULFILLMENTS_CREATE":
        if (!settings || !settings.phoneId || !settings.accessToken) {
          console.log(`⚠️ [SKIP] Skipping FULFILLMENTS_CREATE because settings are incomplete for ${shop}.`);
          break; // Exit this case
        }
        const fulfillment = payload;
        console.log(`[LOG] Processing FULFILLMENTS_CREATE for order GID ${fulfillment.order_id}`);
        
        try {
          const orderResponse = await admin.graphql(
            `#graphql
            query getOrder($id: ID!) {
              order(id: $id) {
                name
                customer {
                  firstName
                  phone
                }
              }
            }`,
            { variables: { id: fulfillment.order_id } }
          );

          const orderData = await orderResponse.json();
          const orderDetails = orderData.data?.order;
          const customer = orderDetails?.customer;
          const trackingLink = fulfillment.tracking_url;
          const trackingNumber = fulfillment.tracking_number;

          if (customer?.phone && trackingLink && settings.fulfillmentTemplate) {
            await sendWhatsAppMessage(settings, customer.phone, settings.fulfillmentTemplate, [
              { type: "text", text: customer.firstName || "Valued Customer" },
              { type: "text", text: orderDetails.name },
              { type: "text", text: trackingNumber || "N/A" },
              { type: "text", text: trackingLink },
            ]);
          } else {
            console.log("⚠️ [SKIP] Fulfillment created, but required info was missing.");
            if (!customer?.phone) console.log("Reason: Customer phone is missing.");
            if (!trackingLink) console.log("Reason: Tracking link is missing.");
            if (!settings.fulfillmentTemplate) console.log("Reason: Fulfillment template name is not set.");
          }
        } catch (error) {
          console.error("❌ [ERROR] Failed to fetch order details for fulfillment:", error);
        }
        break;

      default:
        // This handles any other webhooks you have subscribed to but not explicitly handled.
        console.log(`[LOG] Unhandled webhook topic: ${topic}`);
        break;
    }

    // Return a 200 OK response to Shopify to acknowledge receipt of the webhook.
    return new Response("Webhook processed.", { status: 200 });
  } catch (error) {
    // This catches any errors that happen during the webhook authentication process itself.
    console.error("❌ [FATAL ERROR] Could not process webhook:", error);
    // Return a 500 Internal Server Error response to Shopify.
    return new Response(error.message, { status: 500 });
  }
};
