import { defineHook } from "@directus/extensions-sdk";
import { env } from "process";
import Stripe from "stripe";

export default defineHook(({ filter, action }, { services }) => {
  const { MailService, ItemsService } = services;

  action("users.create", async ({ key, collection, payload }, { schema }) => {
    if (collection !== "directus_users") return;

    try {
      const stripe = new Stripe(env.STRIPE_SECRET_KEY);
      const customer = await stripe.customers.create({
        name: `${payload.first_name} ${payload.last_name}`,
        email: payload.email,
      });

      const usersService = new ItemsService(collection, { schema });
      await usersService.updateByQuery(
        { filter: { id: key } },
        { stripe_customer_id: customer.id },
        { emitEvents: false }
      );
    } catch (error) {
      const mailService = new MailService({ schema });
      mailService.send({
        to: "danzaric10@gmail.com",
        from: "danzaric10@gmail.com",
        subject: `An error has occurred with Stripe API`,
        text: `The following error occurred for ${payload.first_name} ${payload.last_name} when attempting to create an account in Stripe.\r\n\r\n${error}\r\n\r\nPlease investigate.\r\n\r\nID: ${key}\r\nEmail: ${payload.email_address}`,
      });
      console.log("Error while attempting to create Stripe customer", error);
    }
  });
});
