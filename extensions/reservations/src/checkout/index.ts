import { defineEndpoint } from "@directus/extensions-sdk";

export default defineEndpoint((router, context) => {
  const { ItemsService, UsersService } = context.services;

  router.patch("/", async (_req, res) => {
    const schema = await context.getSchema();

    // @ts-ignore
    // this ensures public or unauthenticated calls will get forbidden error
    if (!_req.accountability || !_req.accountability?.user)
      return res.status(403).send("Forbidden");

    // fetch user data (will be needed in case of paid by plan or paid by tokens)
    const [user, userError] = await fetchUser(_req, schema);
    if (userError) return errorResponse(res, "Couldn't fetch user data", 500);

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

    // get user's cart
    const [cart, cartError] = await fetchUserCart(schema, user.cart);
    if (cartError)
      return errorResponse(
        res,
        "Internal server error while fetching user cart",
        500
      );
    if (!cart) return errorResponse(res, "User doesnt have a cart", 400);

    if (userPlan) {
      // validate user active plan
      const valid = await validateUserCartWithPlan(_req, schema);
      if (!valid)
        return errorResponse(res, "Cart was invalidated by plan", 400);

      // user will reserve slots with active plan
      const [_, planReservationError] = await reserveWithPlan(
        _req,
        schema,
        userPlan,
        cart
      );
      if (planReservationError)
        return errorResponse(res, "Couldnt reserve with plan", 500);
    } else {
      const valid = await validateUserCartWithTokens(_req, schema);
      if (!valid)
        return errorResponse(res, "Cart was invalidated by tokens", 400);

      // user will reserve slots with spending tokens
      const [_, tokensReservationError] = await reserveWithTokens(
        _req,
        schema,
        userPlan,
        cart
      );
      if (tokensReservationError)
        return errorResponse(res, "Couldnt reserve with tokens", 500);
    }

    return res.status(200).send({ slots: slots });
  });

  const fetchUser = async (req: any, schema: any) => {
    const usersService = new UsersService({
      schema: schema,
    });

    const [user, error] = await tryCatcher<any>(
      usersService.readOne(req.accountability?.user, {
        fields: [
          "id",
          "tokens",
          "plans.*",
          "plans.plans_id.*",
          "cart",
          "slots",
        ],
        deep: {
          slots: {
            _filter: {
              date: {
                date: {
                  _gte: "$NOW",
                },
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

  const fetchUserCart = async (schema: any, cartID: any) => {
    const cartsService = new ItemsService("carts", {
      schema: schema,
    });

    const [cart, error] = await tryCatcher(
      cartsService.readOne(cartID, {
        fields: [
          "id",
          "service",
          "slots.id",
          "slots.price",
          "slots.capacity",
          "slots.date.date",
        ],
      })
    );
    if (error) {
      context.logger.error(
        `Something went wrong while reading user's cart: ${error}`
      );
    }

    return [cart, error];
  };

  const validateUserCartWithPlan = (req: any, schema: any) => {
    return true;
  };

  const validateUserCartWithTokens = (req: any, schema: any) => {
    return true;
  };

  const reserveWithPlan = async (
    req: any,
    schema: any,
    userPlan: any,
    cart: any
  ) => {
    const trx = await context.database.transaction();

    return [null, null];
  };

  const reserveWithTokens = async (
    req: any,
    schema: any,
    userPlan: any,
    cart: any
  ) => {
    return [null, null];
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
