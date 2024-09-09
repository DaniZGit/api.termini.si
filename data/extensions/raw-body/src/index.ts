import { defineHook } from "@directus/extensions-sdk";
import express from "express";

// express has .body property but no rawBody
// to verify stripe webhook request and payload, stripe required raw body so we append it here
// more about it: https://github.com/directus/directus/discussions/8633
export default defineHook(({ filter, action, init }) => {
  init("middlewares.before", async ({ app }) => {
    app.use(
      express.json({
        verify: (req, res, buf) => {
          if (req.originalUrl.startsWith("/payment-webhook"))
            req.rawBody = buf.toString();
        },
      })
    );
  });
});
