import { defineEndpoint } from "@directus/extensions-sdk";

export default defineEndpoint((router, context) => {
  router.patch("/", async (_req, res) => {
    // @ts-ignore
    // this ensures public or unauthenticated calls will get forbidden error
    if (!_req.accountability || !_req.accountability?.user)
      return res.status(403).send("Forbidden");

    // validate request payload
    if (!_req.body.slots || !Array.isArray(_req.body.slots))
      return res.status(400).send("Wrong data or wrong data type");

    if (_req.body.service != null && typeof _req.body.service != "string") {
      _req.body.service = null;
      _req.body.slots = [];
    }

    const schema = await context.getSchema();

    // get user cart
    const [cartID, readCartError] = await readOrCreateUserCart(
      _req,
      context,
      schema
    );
    if (readCartError) return errorResponse(res, readCartError);

    // validate and update cart
    const updateCartError = await updateCart(_req, context, schema, cartID);
    if (updateCartError) return errorResponse(res, updateCartError);

    // get slots in the cart
    const [slots, readCartSlotsError] = await readCartSlots(
      context,
      schema,
      cartID
    );
    if (readCartSlotsError) return errorResponse(res, readCartSlotsError);

    return res.status(200).send({ slots: slots });
  });
});

const readOrCreateUserCart = async (req: any, context: any, schema: any) => {
  const { ItemsService, UsersService } = context.services;
  const usersService = new UsersService({
    schema: schema,
  });
  const cartsService = new ItemsService("carts", {
    schema: schema,
  });

  // get user with cart
  const [user, readError] = await tryCatcher<any>(
    usersService.readOne(req.accountability?.user, {
      fields: ["id", "cart"],
    })
  );
  if (readError) {
    context.logger.error(
      `Something went wrong while fetching user(${req.accountability?.user}) cart reservation: ${readError}`
    );
    return [
      null,
      "Internal server error while fetching user's cart reservation",
    ];
  }

  if (!user.cart) {
    // user doesn't have a cart, so we create one
    const [cartID, createError] = await tryCatcher(
      cartsService.createOne({
        time_slots: [],
      })
    );
    if (createError) {
      context.logger.error(
        `Something went wrong while creating a cart for user(${req.accountability?.user}): ${createError}`
      );
      return [null, "Internal server error while creating user cart"];
    }

    // link the newly created cart to the user
    const [_, updateError] = await tryCatcher<string>(
      usersService.updateOne(req.accountability?.user, {
        cart: cartID,
      })
    );
    if (updateError) {
      context.logger.error(
        `Something went wrong while updating user(${req.accountability?.user}) cart(${cartID}): ${updateError}`
      );
      return [null, "Internal server error while updating user's cart"];
    }

    return [cartID, null];
  }

  // user has a cart
  return [user.cart, null];
};

const updateCart = async (req: any, context: any, schema: any, cartID: any) => {
  // reserve selected slots
  const createError = await addSlotsToCart(
    schema,
    context,
    req.body.slots,
    cartID
  );
  if (createError) {
    context.logger.error(
      `Something went wrong while adding slots to the cart: ${createError}`
    );
    return "Internal server error while adding slots to the cart";
  }

  // remove other slots from the cart
  const deleteError = await deleteSlotsFromCart(
    schema,
    context,
    req.body.slots,
    cartID
  );
  if (deleteError) {
    context.logger.error(
      `Something went wrong while removing slots from the cart: ${deleteError}`
    );
    return "Internal server error while removing slots from the cart";
  }

  // update cart date_updated field
  await updateCartDateField(schema, context, cartID, req.body.service);

  return null;
};

const readCartSlots = async (context: any, schema: any, cartID: string) => {
  const { ItemsService } = context.services;
  const slotsService = new ItemsService("slots", {
    schema: schema,
  });

  // get cart's slots
  const [slots, readError] = await tryCatcher<any>(
    slotsService.readByQuery({
      fields: [
        "id",
        "start_time",
        "end_time",
        "price",
        "available",
        "date.date",
        "date.schedule.id",
        "date.schedule.title",
      ],
      filter: {
        carts: {
          carts_id: {
            _eq: cartID,
          },
        },
      },
    })
  );
  if (readError) {
    context.logger.error(
      `Something went wrong while fetching cart slots: ${readError}`
    );
    return [null, "Internal server error while fetching cart slots"];
  }

  return [slots, null];
};

const addSlotsToCart = async (
  schema: any,
  context: any,
  slotIds: any[],
  cartID: any
) => {
  if (!slotIds.length) return null;

  const { ItemsService } = context.services;
  const slotsService = new ItemsService("slots", {
    schema: schema,
  });
  const cartsSlotsService = new ItemsService("carts_slots", {
    schema: schema,
  });

  // get slots that were selected by the user and are available
  let [slots, readError] = await tryCatcher<any[]>(
    slotsService.readByQuery({
      fields: ["id", "users", "carts", "capacity"],
      filter: {
        _and: [
          {
            id: {
              _in: slotIds,
            },
          },
          {
            available: {
              _eq: true,
            },
          },
          {
            date: {
              date: {
                _gte: "$NOW",
              },
            },
          },
          {
            _or: [
              {
                carts: {
                  carts_id: {
                    _eq: cartID,
                  },
                },
              },
              {
                carts: {
                  carts_id: {
                    _null: true,
                  },
                },
              },
            ],
          },
        ],
      },
    })
  );
  if (readError) return readError;

  // do an extra validation regarding slot capacity (if users.length + carts.length < capacity == can reserve)
  slots =
    slots?.filter(
      (slot) => slot.users?.length + slot.carts?.length < slot.capacity
    ) ?? null;

  if (slots && slots.length) {
    // here we only add them to the cart, the "available" field will get set in the update hook of the slots collection
    const [_, createError] = await tryCatcher(
      cartsSlotsService.createMany(
        slots.map((slot) => ({
          slots_id: slot.id,
          carts_id: cartID,
        }))
      )
    );
    if (createError) return createError;
  }

  return null;
};

const deleteSlotsFromCart = async (
  schema: any,
  context: any,
  slotIds: any[],
  cartID: any
) => {
  const { ItemsService } = context.services;
  const cartsSlotsService = new ItemsService("carts_slots", {
    schema: schema,
  });

  const [_, deleteError] = await tryCatcher(
    cartsSlotsService.deleteByQuery({
      filter: {
        _and: [
          {
            carts_id: {
              _eq: cartID,
            },
          },
          {
            _or: [
              {
                slots_id: {
                  _nin: slotIds,
                },
              },
              {
                slots_id: {
                  date: {
                    date: {
                      _lt: "$NOW",
                    },
                  },
                },
              },
            ],
          },
        ],
      },
    })
  );

  return deleteError;
};

const updateCartDateField = async (
  schema: any,
  context: any,
  cartID: any,
  service: any
) => {
  const { ItemsService } = context.services;
  const cartsService = new ItemsService("carts", {
    schema: schema,
  });

  // update cart date_updated field
  const [__, updateError] = await tryCatcher(
    cartsService.updateOne(cartID, { date_updated: "$NOW", service: service })
  );
  if (updateError) {
    context.logger.error(
      `Something went wrong while updating cart date_updated field: ${updateError}`
    );
  }
};

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
