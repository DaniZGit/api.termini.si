import { defineEndpoint } from "@directus/extensions-sdk";

export default defineEndpoint((router, context) => {
  const { ItemsService, UsersService } = context.services;

  router.post("/", async (_req, res) => {
    const schema = await context.getSchema();

    // @ts-ignore
    // this ensures public or unauthenticated calls will get forbidden error
    if (!_req.accountability || !_req.accountability?.user)
      return res.status(403).send("Forbidden");

    // fetch user with reservations data
    const [user, userError] = await fetchUser(_req, schema);
    if (userError) return errorResponse(res, "Couldn't fetch user data", 500);
    if (!user.reservations || !user.reservations.length)
      return errorResponse(res, "User has no slots in the cart", 400);

    // check if plan reservations are being used
    let userPlan = null;
    if (_req.body.plan_id) {
      if (
        typeof _req.body.plan_id !== "number" &&
        typeof _req.body.plan_id !== "string"
      )
        return errorResponse(res, "Wrong plan_id type", 400);

      // check if user has the plan in use
      userPlan = user?.plans?.find(
        (plan: any) => plan.plans_id.id == _req.body.plan_id
      );
      if (!userPlan) return errorResponse(res, "User has no such plan", 400);
    }

    if (userPlan) {
      // validate user reservations with active plan
      const valid = await validateReservationsViaPlan(_req, schema);
      if (!valid)
        return errorResponse(res, "Cart was invalidated by plan", 400);

      // user will reserve slots with active plan
      const planCheckoutError = await checkoutWithPlan(schema, user, userPlan);
      if (planCheckoutError)
        return errorResponse(res, "Couldnt reserve with plan", 500);
    } else {
      const valid = await validateReservationsViaTokens(_req, schema);
      if (!valid)
        return errorResponse(res, "Cart was invalidated by tokens", 400);

      // user will reserve slots with spending tokens
      const tokensReservationError = await checkoutWithTokens(schema, user);
      if (tokensReservationError)
        return errorResponse(res, "Couldnt reserve with tokens", 500);
    }

    return res.status(200).send();
  });

  const fetchUser = async (req: any, schema: any) => {
    const usersService = new UsersService({
      schema: schema,
    });

    const [user, error] = await tryCatcher<any>(
      usersService.readOne(req.accountability?.user, {
        fields: [
          "*",
          "plans.*",
          "plans.plans_id.*",
          "reservations.*",
          "reservations.slot.*",
          "reservations.slot.slot_definition.*",
        ],
        deep: {
          reservations: {
            _filter: {
              status: {
                _eq: "held",
              },
            },
          },
        },
      })
    );
    if (error) {
      context.logger.error(
        `Something went wrong while reading user plans: ${error}`
      );
    }

    return [user, error];
  };

  /* @ts-ignore */
  const validateReservationsViaPlan = (req: any, schema: any) => {
    // check if ALL slots agree with plan rules

    // be careful cause some plans are global, some are specific for service
    return true;
  };

  /* @ts-ignore */
  const validateReservationsViaTokens = (req: any, schema: any) => {
    return true;
  };

  const checkoutWithPlan = async (schema: any, user: any, userPlan: any) => {
    const reservationService = new ItemsService("reservations", {
      schema: schema,
    });
    const userPlanService = new ItemsService("plans_directus_users", {
      schema: schema,
    });

    // reserve slots
    const [_, updateError] = await tryCatcher<any[]>(
      reservationService.updateMany(
        /* @ts-ignore */
        user.reservations.map((reservation) => reservation.id),
        {
          status: "confirmed",
        }
      )
    );
    if (updateError) {
      context.logger.error(
        `Something went wrong while confirming user reservations: ${updateError}`
      );
      return "Something went wrong while trying to reserve user slots";
    }

    // update user plan
    const [__, planUpdateError] = await tryCatcher(
      userPlanService.updateOne(userPlan.id, {
        total_reservations:
          userPlan.total_reservations - user.reservations.length,
      })
    );
    if (planUpdateError) {
      context.logger.error(
        `Something went wrong while updating user plan: ${planUpdateError}`
      );
      return "Something went wrong while trying to reserve user slots";
    }

    return null;
  };

  /* @ts-ignore */
  const checkoutWithTokens = async (schema: any, user: any) => {
    const reservationService = new ItemsService("reservations", {
      schema: schema,
    });
    const usersService = new UsersService({
      schema: schema,
    });

    // reserve slots
    const [_, updateError] = await tryCatcher<any[]>(
      reservationService.updateMany(
        /* @ts-ignore */
        user.reservations.map((reservation) => reservation.id),
        {
          status: "confirmed",
        }
      )
    );
    if (updateError) {
      context.logger.error(
        `Something went wrong while confirming user reservations: ${updateError}`
      );
      return "Something went wrong while trying to reserve user slots";
    }

    // update user's tokens amount
    const [__, userUpdateError] = await tryCatcher(
      usersService.updateOne(user.id, {
        tokens:
          user.tokens -
          user.reservations.reduce(
            (sum: number, reservation: any) =>
              sum + reservation.slot.slot_definition.price,
            0
          ),
      })
    );

    if (userUpdateError) {
      context.logger.error(
        `Something went wrong while updating user's tokens amount: ${userUpdateError}`
      );
      return "Something went wrong while trying to reserve user slots";
    }

    return null;
  };
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

const errorResponse = (res: any, message: string, code: number = 500) => {
  return res.status(code).send(message);
};
