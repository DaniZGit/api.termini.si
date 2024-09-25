import { defineHook } from "@directus/extensions-sdk";
import { env } from "process";
import { Stripe } from "stripe";

export default defineHook(({ filter, action }, { services, logger }) => {
  const { MailService, ItemsService } = services;

  action("users.create", async ({ key, collection, payload }, { schema }) => {
    if (!env.STRIPE_SECRET_KEY) {
      logger.error("STRIPE_SECRET_KEY is not set in the environment");
      return;
    }

    const stripe = new Stripe(env.STRIPE_SECRET_KEY);
    const [customer, stripeError] = await tryCatcher(
      stripe.customers.create({
        name: `${payload.first_name} ${payload.last_name}`,
        email: payload.email,
      })
    );
    if (stripeError) {
      const mailService = new MailService({ schema });
      mailService.send({
        to: "danzaric10@gmail.com",
        from: "danzaric10@gmail.com",
        subject: `An error has occurred with Stripe API`,
        text: `The following error occurred for ${payload.first_name} ${payload.last_name} when attempting to create an account in Stripe.\r\n\r\n${stripeError}\r\n\r\nPlease investigate.\r\n\r\nID: ${key}\r\nEmail: ${payload.email_address}`,
      });
      logger.error(
        "Error while attempting to create Stripe customer",
        stripeError
      );
      return;
    }

    const usersService = new ItemsService(collection, { schema });
    const [_, updateError] = await tryCatcher(
      usersService.updateByQuery(
        { filter: { id: key } },
        { stripe_customer_id: customer.id },
        { emitEvents: false }
      )
    );
    if (updateError) {
      logger.error(
        "Error while updating user's stripe_customer_id",
        updateError
      );
    }
  });
});

async function tryCatcher<T, E = Error>(
  promise: Promise<T>
): Promise<[T, null] | [null, E]> {
  try {
    const result = await promise;
    return [result, null];
  } catch (error) {
    return [null, error as E];
  }
}
