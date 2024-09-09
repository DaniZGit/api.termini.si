import { defineEndpoint } from "@directus/extensions-sdk";
import { env } from "process";
import Stripe from "stripe";

const stripe = new Stripe(env.STRIPE_SECRET_KEY);
const webhookSecret = env.STRIPE_PAYMENT_WEBHOOK_SECRET;

export default defineEndpoint((router, context) => {
  router.post("/", async (_req, res) => {
    const sig = _req.headers["stripe-signature"];
    let event;

    try {
      event = stripe.webhooks.constructEvent(_req.rawBody, sig, webhookSecret);
    } catch (err: any) {
      console.log("Payment Webhook: Error while construsting event", err);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }
    if (!event) return res.status(400).send(`No event object`);

    const { ItemsService } = context.services;

    // Handle the event
    switch (event?.type) {
      case "payment_intent.succeeded":
        const paymentIntent = event.data.object;

        const schema = await context.getSchema();
        const transactionsService = new ItemsService("transactions", {
          schema: schema,
        });
        const usersService = new ItemsService("directus_users", {
          schema: schema,
        });

        try {
          // find transaction that was completed
          const transaction = await transactionsService.readSingleton({
            filter: {
              stripe_payment_intent_id: {
                _eq: paymentIntent.id,
              },
              status: {
                _eq: "pending",
              },
            },
          });
          if (!transaction) break;

          // read user whose transaction was succesfull
          const user = await usersService.readOne(transaction.user);
          if (!user) break;

          // add tokens to the user
          const userTokens = parseFloat(user.tokens) || 0;
          const transactionTokens = paymentIntent.amount / 100;
          await usersService.updateOne(user.id, {
            tokens: (userTokens + transactionTokens).toFixed(2),
          });

          // update transaction status
          await transactionsService.updateOne(transaction.id, {
            status: "success",
          });
        } catch (error) {
          console.log(
            "Payment Webhook: Something went wrong on the payment webhook !!!",
            error
          );
        }
        break;
      default:
    }

    // Return a response to acknowledge receipt of the event
    return res.send({ received: true });
  });
});
