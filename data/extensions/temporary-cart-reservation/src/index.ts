import { defineEndpoint } from "@directus/extensions-sdk";

export default defineEndpoint((router, context) => {
  router.patch("/", async (_req, res) => {
    // this ensures public or unauthenticated calls will get forbidden error
    if (!_req.accountability || !_req.accountability?.user)
      return res.status(403).send("Forbidden");

    if (
      !_req.body.freebies ||
      !_req.body.hodlers ||
      !Array.isArray(_req.body.freebies) ||
      !Array.isArray(_req.body.hodlers)
    )
      return res.status(400).send("Wrong data");

    // get cart reservation
    const { id: userCartReservationID, error: readCreateCartReservationError } =
      await readOrCreateUserCartReservation(_req, context);
    if (readCreateCartReservationError)
      return res.status(500).send(readCreateCartReservationError);

    // update cart reservation and time slots
    const { ids: cartTimeSlotIDs, error: updateCartReservationError } =
      await updateUserCartReservation(userCartReservationID, _req, context);
    if (updateCartReservationError)
      return res.status(500).send(updateCartReservationError);

    return res.status(200).send({
      cart_reservation_id: userCartReservationID,
      time_slot_ids: cartTimeSlotIDs,
    });
  });
});

const readOrCreateUserCartReservation = async (req: any, context: any) => {
  let userReservationID = 0;
  let error = "";

  const { ItemsService } = context.services;

  const cartReservationsService = new ItemsService("cart_reservations", {
    schema: await context.getSchema(),
  });

  try {
    // check if cart reservation for current user already exists
    const data = await cartReservationsService.readByQuery({
      filter: {
        user: {
          _eq: req.accountability?.user,
        },
      },
    });

    if (data.length) {
      userReservationID = data[0].id;
    } else {
      // create a new cart reservation if one does not exist for current user
      userReservationID = await cartReservationsService.createOne({
        user: req.accountability?.user,
        time_slots: [],
      });
    }
  } catch (error) {
    error = error;
  }

  return {
    id: userReservationID,
    error: error,
  };
};

const updateUserCartReservation = async (id: any, req: any, context: any) => {
  let timeSlotsIds: string[] = [];
  let error = "";

  const { ItemsService } = context.services;
  const schema = await context.getSchema();

  const timeSlotsService = new ItemsService("time_slots", {
    schema: schema,
  });
  const cartReservationsService = new ItemsService("cart_reservations", {
    schema: schema,
  });

  try {
    // hodl time_slots
    if (req.body.hodlers.length) {
      await timeSlotsService.updateByQuery(
        {
          filter: {
            _and: [
              {
                id: {
                  _in: req.body.hodlers,
                },
              },
              {
                status: {
                  _eq: "available",
                },
              },
              {
                booked_by_user: {
                  _null: true,
                },
              },
              {
                _or: [
                  {
                    cart_reservation: {
                      _eq: id,
                    },
                  },
                  {
                    cart_reservation: {
                      _null: true,
                    },
                  },
                ],
              },
              {},
            ],
          },
        },
        {
          status: "unavailable",
          cart_reservation: id,
        }
      );
    }

    // free time_slots
    if (req.body.freebies.length) {
      await timeSlotsService.updateByQuery(
        {
          filter: {
            _and: [
              {
                _or: [
                  {
                    id: {
                      _in: req.body.freebies,
                    },
                  },
                  {
                    id: {
                      _nin: req.body.hodlers,
                    },
                  },
                ],
              },
              {
                booked_by_user: {
                  _null: true,
                },
              },
              {
                cart_reservation: {
                  _eq: id,
                },
              },
            ],
          },
        },
        {
          status: "available",
          cart_reservation: null,
        }
      );
    }

    // now fetch all available timeSlots
    const hodledTimeSlots = await timeSlotsService.readByQuery({
      fields: [
        "id",
        "start_time",
        "end_time",
        "price",
        "status",
        "schedule_day.date",
        "schedule_day.court.id",
        "schedule_day.court.title",
        "schedule_day.court.institution.id",
        "schedule_day.court.institution.slug",
      ],
      filter: {
        cart_reservation: {
          _eq: id,
        },
        schedule_day: {
          date: {
            _gte: "$NOW", // remove slots older than today from the cart
          },
        },
        booked_by_user: {
          _null: true,
        },
      },
    });
    timeSlotsIds = hodledTimeSlots.map((timeSlot) => timeSlot.id);

    // update user cart_reservation
    await cartReservationsService.updateOne(id, {
      time_slots: timeSlotsIds,
    });
  } catch (error) {
    error = error;
  }

  return {
    ids: timeSlotsIds,
    error: error,
  };
};
