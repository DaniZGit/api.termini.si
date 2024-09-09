import { defineEndpoint } from "@directus/extensions-sdk";
import { env } from "process";
import Stripe from "stripe";

export default defineEndpoint((router, context) => {
  router.get("/", async (_req, res) => {
    // this ensures public or unauthenticated calls will get forbidden error
    if (!_req.accountability || !_req.accountability?.user)
      return res.status(403).send("Forbidden");

    // read query param
    const query: { tokens: string } = _req.query;
    if (!query.tokens) {
      res.status(400).send("No tokens set");
      return;
    } else if (typeof query.tokens !== "string") {
      res.status(400).send("Query tokens must be a string");
      return;
    }

    // validate tokens param
    const tokens = parseFloat(query.tokens) || 0;
    if (tokens <= 5 || tokens > 500) {
      return res
        .status(400)
        .send("tokens amount must be greater than 5 and less than 500");
    }

    // create stripe instance
    const stripe = new Stripe(env.STRIPE_SECRET_KEY);
    const { ItemsService } = context.services;
    const schema = await context.getSchema();

    try {
      // get user customer ID
      const usersService = new ItemsService("directus_users", { schema });
      const user = await usersService.readOne(_req.accountability?.user);
      let customerID = user?.stripe_customer_id ?? "";
      if (user && !customerID)
        customerID = await createCustomer(stripe, user, context);

      // create payment intent
      const amount = tokens * 100;
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "eur",
        automatic_payment_methods: {
          enabled: true,
        },
        customer: customerID,
      });

      // create transaction
      const transactionsService = new ItemsService("transactions", {
        schema,
      });
      const transaction = await transactionsService.createOne({
        type: "topup",
        stripe_payment_intent_id: paymentIntent.id,
        status: "pending",
        user: _req.accountability?.user,
      });

      res.send({
        client_secret: paymentIntent.client_secret,
        tokens: tokens,
        amount: amount,
        transaction: transaction.id,
      });
    } catch (error) {
      return res.status(500).send(error);
    }
  });
});

const createCustomer = async (stripe: Stripe, user: any, context: any) => {
  let customerID = "";
  const { ItemsService } = context.services;
  const schema = await context.getSchema();

  try {
    const stripe = new Stripe(env.STRIPE_SECRET_KEY);
    const customer = await stripe.customers.create({
      name: `${user.first_name} ${user.last_name}`,
      email: user.email,
    });

    const usersService = new ItemsService("directus_users", { schema });
    await usersService.updateByQuery(
      { filter: { id: user.id } },
      { stripe_customer_id: customer.id },
      { emitEvents: false }
    );

    customerID = customer.id;
  } catch (error) {
    console.log(
      "Error while attempting to create Stripe customer from the /stripe-payment-intent endpoint",
      error
    );
  }

  return customerID;
};
