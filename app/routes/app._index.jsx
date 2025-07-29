// app/routes/app._index.jsx

import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, Form } from "@remix-run/react";
import {
  Page,
  Layout,
  LegacyCard,
  FormLayout,
  TextField,
  Banner,
  Text,
  BlockStack,
  Button,
} from "@shopify/polaris";
import { useState, useCallback, useEffect } from "react";
import { authenticate } from "../shopify.server";
import db from "../db.server";

// Load existing settings from the database for the current shop
export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const settings = await db.whatsAppSettings.findUnique({
    where: { shop: session.shop },
  });
  return json(settings || {});
};

// Save settings to the database for the current shop
export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const { phoneId, accessToken, confirmationTemplate, fulfillmentTemplate } =
    Object.fromEntries(await request.formData());

  const currentSettings = await db.whatsAppSettings.findUnique({
    where: { shop: session.shop },
  });

  const dataToSave = {
    phoneId,
    confirmationTemplate,
    fulfillmentTemplate,
    accessToken:
      accessToken && !accessToken.includes("••••")
        ? accessToken
        : currentSettings?.accessToken,
  };

  await db.whatsAppSettings.upsert({
    where: { shop: session.shop },
    update: dataToSave,
    create: {
      shop: session.shop,
      ...dataToSave,
    },
  });

  return json({ success: true });
};

export default function SettingsPage() {
  const settings = useLoaderData();
  const navigation = useNavigation();
  const isSaving = navigation.state === "submitting";

  const [formState, setFormState] = useState({
    phoneId: settings.phoneId || "",
    accessToken: settings.accessToken ? "••••••••••••••••" : "",
    confirmationTemplate: settings.confirmationTemplate || "",
    fulfillmentTemplate: settings.fulfillmentTemplate || "",
  });

  const [showSuccessBanner, setShowSuccessBanner] = useState(false);

  useEffect(() => {
    if (navigation.state === "idle" && navigation.formData) {
      setShowSuccessBanner(true);
      const timer = setTimeout(() => setShowSuccessBanner(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [navigation]);

  const handleInputChange = useCallback((field) => (value) => {
    setFormState((prev) => ({ ...prev, [field]: value }));
  }, []);

  return (
    <Page>
      <BlockStack gap="500">
        {showSuccessBanner && (
          <Banner
            title="Settings saved successfully"
            status="success"
            onDismiss={() => setShowSuccessBanner(false)}
          />
        )}
        <Layout>
          <Layout.Section>
            <Form method="post">
              <BlockStack gap="500">
                <LegacyCard sectioned>
                  <BlockStack gap="500">
                    <Text variant="headingMd" as="h2">
                      API Settings
                    </Text>
                    <FormLayout>
                      <TextField
                        name="phoneId"
                        value={formState.phoneId}
                        onChange={handleInputChange("phoneId")}
                        label="Phone Number ID"
                        autoComplete="off"
                      />
                      <TextField
                        name="accessToken"
                        value={formState.accessToken}
                        onChange={handleInputChange("accessToken")}
                        label="API Access Token"
                        type="password"
                        autoComplete="off"
                        helpText="Enter your permanent System User Access Token. Field will appear masked after saving."
                      />
                    </FormLayout>
                  </BlockStack>
                </LegacyCard>
                <LegacyCard sectioned>
                  <BlockStack gap="500">
                    <Text variant="headingMd" as="h2">
                      Message Templates
                    </Text>
                    <FormLayout>
                      <TextField
                        name="confirmationTemplate"
                        value={formState.confirmationTemplate}
                        onChange={handleInputChange("confirmationTemplate")}
                        label="Order Confirmation Template Name"
                        autoComplete="off"
                        helpText="Template with 4 parameters: {{1}} customer name, {{2}} order number, {{3}} total price, {{4}} product names."
                      />
                      <TextField
                        name="fulfillmentTemplate"
                        value={formState.fulfillmentTemplate}
                        onChange={handleInputChange("fulfillmentTemplate")}
                        label="Order Fulfillment Template Name"
                        autoComplete="off"
                        helpText="Template with 4 parameters: {{1}} customer name, {{2}} order number, {{3}} tracking number, {{4}} tracking link."
                      />
                    </FormLayout>
                  </BlockStack>
                </LegacyCard>
                <Button submit loading={isSaving} variant="primary">
                  Save Settings
                </Button>
              </BlockStack>
            </Form>
          </Layout.Section>
          <Layout.Section variant="oneThird">
            <LegacyCard sectioned>
              <BlockStack gap="200">
                <Text variant="headingMd" as="h3">
                  Instructions
                </Text>
                <Text>
                  1. Get your <strong>Phone Number ID</strong> and a permanent{" "}
                  <strong>Access Token</strong> from your app on the Meta
                  Developer Portal.
                </Text>
                <Text>
                  2. Create and approve your WhatsApp message templates with the
                  correct number of parameters.
                </Text>
                <Text>
                  3. Enter the credentials and template names here and click{" "}
                  <strong>Save</strong>.
                </Text>
              </BlockStack>
            </LegacyCard>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
