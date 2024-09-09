import { defineEndpoint } from "@directus/extensions-sdk";

export default defineEndpoint((router, context) => {
  router.post("/", async (_req, res) => {
    // this ensures public or unauthenticated calls will get forbidden error
    if (!_req.accountability || !_req.accountability?.user)
      return res.status(403).send("Forbidden");

    const schema = await context.getSchema();

    // fetch user data
    const { user, error: userError } = await fetchUser(_req, context, schema);

    // check if plan reservations are being used
    let userPlan = null;
    if (_req.body.plan_id) {
      if (typeof _req.body.plan_id !== "number")
        return niceError(res, 400, "Wrong plan_id type");

      userPlan = user.plans.find(
        (plan) => plan.plans_id.id == _req.body.plan_id
      );
      if (!userPlan) return niceError(res, 400, "User has no such plan");
    }

    // fetch cart reservation data
    const { cartReservation, error: cartReservationError } =
      await fetchUserCartReservation(_req, context, schema);

    // check for errors
    if (userError || cartReservationError)
      return niceError(res, 500, userError || cartReservationError);

    if (userPlan) {
      // validate time_slots with the selected plan
      const { error: validatePlanReservationError } =
        await validatePlanReservations(
          _req,
          context,
          schema,
          userPlan,
          cartReservation
        );
      if (validatePlanReservationError)
        return niceError(res, 500, validatePlanReservationError);

      // remove plan reservations
      const { error: planReservationError } = await removePlanReservations(
        _req,
        context,
        schema,
        userPlan,
        cartReservation
      );
      if (planReservationError)
        return niceError(res, 500, planReservationError);
    } else {
      // check if user has enough tokens
      const userTokens = parseFloat(user.tokens);
      const slotsPrice = cartReservation.time_slots.reduce(
        (sum, timeSlot) => sum + parseFloat(timeSlot.price) || 0,
        0
      );
      if (userTokens < slotsPrice)
        return niceError(res, 400, "Not enough tokens");

      // validate time_slots with the institution default plan: TODO
      const { error: validatePlanReservationError } =
        await validateDefaultPlanReservations(
          _req,
          context,
          schema,
          cartReservation
        );
      if (validatePlanReservationError)
        return niceError(res, 500, validatePlanReservationError);

      // remove user tokens
      const { error: userTokensError } = await removeUserTokens(
        _req,
        context,
        schema,
        userTokens - slotsPrice
      );
      if (userTokensError) return niceError(res, 500, userTokensError);
    }

    // update time_slots
    const { error: timeSlotsError } = await reserveTimeSlots(
      _req,
      context,
      schema,
      cartReservation
    );
    if (timeSlotsError) return niceError(res, 500, timeSlotsError);

    // create transaction
    const { error: transactionError } = await createBookingTransaction(
      _req,
      context,
      schema,
      cartReservation
    );
    if (transactionError) return niceError(res, 500, transactionError);

    return res.status(200).send();
  });
});

const fetchUser = async (req: any, context: any, schema: any) => {
  let user = null;
  let error = null;

  const { UsersService } = context.services;
  const usersService = new UsersService({
    schema: schema,
  });

  try {
    user = await usersService.readOne(req.accountability?.user, {
      fields: ["id", "tokens", "plans.*", "plans.plans_id.*"],
    });
  } catch (err) {
    error = err;
  }

  return { user, error };
};

const fetchUserCartReservation = async (
  req: any,
  context: any,
  schema: any
) => {
  let cartReservation = null;
  let error = null;

  const { ItemsService } = context.services;
  const cartReservationsService = new ItemsService("cart_reservations", {
    schema: schema,
  });

  try {
    const data = await cartReservationsService.readByQuery({
      filter: {
        user: {
          _eq: req.accountability?.user,
        },
      },
      fields: [
        "id",
        "time_slots.id",
        "time_slots.price",
        "time_slots.schedule_day.date",
        "time_slots.schedule_day.court.institution",
        "time_slots.schedule_day.court.sport",
      ],
    });

    if (data.length) {
      cartReservation = data[0];
    }
  } catch (err) {
    error = err;
  }

  return { cartReservation, error };
};

const removeUserTokens = async (
  req: any,
  context: any,
  schema: any,
  tokens: number
) => {
  let user = null;
  let error = null;

  const { UsersService } = context.services;
  const usersService = new UsersService({
    schema: schema,
  });

  try {
    user = await usersService.updateOne(req.accountability?.user, {
      tokens: tokens,
    });
  } catch (err) {
    error = err;
  }

  return { user, error };
};

const validatePlanReservations = async (
  req: any,
  context: any,
  schema: any,
  userPlan: any,
  cartReservation: any
) => {
  let error: string = "";
  const plan = userPlan.plans_id;

  try {
    // check if user has enough plan reservations left
    if (cartReservation.time_slots.length > plan.total_reservations)
      error = `Too many slots, only ${plan.total_reservations} reservations are left in the current plan`;

    // group time slots per day
    const timeSlotsByDates: Record<string, object[]> = {};
    cartReservation.time_slots.forEach((timeSlot) => {
      if (timeSlotsByDates[timeSlot.schedule_day.date]) {
        timeSlotsByDates[timeSlot.schedule_day.date].push(timeSlot);
      } else {
        timeSlotsByDates[timeSlot.schedule_day.date] = [timeSlot];
      }
    });

    // loop grouped timeSlots
    Object.entries(timeSlotsByDates).forEach(([date, timeSlots]) => {
      const currDate = getCurrentDateInSloTimezone();
      currDate.setHours(0, 0, 0, 0);
      const timeSlotDate = new Date(date);
      timeSlotDate.setHours(0, 0, 0, 0);

      currDate.setDate(currDate.getDate() + plan.days_in_advance_to_reserve);

      // check if date is < curr + days_in_advance_to_reserve
      if (currDate.getTime() < timeSlotDate.getTime()) {
        error = `Cannot reserve slots that much advance in the future`;
        return;
      }

      // check if amount of slots is < total_reservations_per_day
      if (timeSlots.length > plan.total_reservations_per_day) {
        error = `Cannot reserve more than ${plan.total_reservations_per_day} slots per day`;
        return;
      }

      // check each slot for sports matching (if plan has a sport field set)
      // also check that time slot is from the same institution that the plan is for
      if (plan.sport) {
        timeSlots.forEach((timeSlot) => {
          if (timeSlot.schedule_day.court.sport != plan.sport) {
            error = `This plan does not support slot reservations of different sports`;
            return;
          } else if (
            timeSlot.schedule_day.court.institution != plan.institution
          ) {
            error = `Plan belongs to a different institution's time slots`;
            return;
          }
        });

        if (error) return;
      }
    });
  } catch (err) {
    error = "Something weird went wrong during plan validation";
  }

  return { error };
};

const validateDefaultPlanReservations = async (
  req: any,
  context: any,
  schema: any,
  cartReservation: any
) => {
  let error: string = "";

  const { ItemsService } = context.services;
  const institutionsService = new ItemsService("institutions", {
    schema: schema,
  });

  try {
    // get institution data
    const institution = await institutionsService.readOne(
      cartReservation.time_slots.at(0).schedule_day.court.institution,
      {
        fields: [
          "id",
          "total_reservations_per_day",
          "days_in_advance_to_reserve",
        ],
      }
    );

    // group time slots per day
    const timeSlotsByDates: Record<string, object[]> = {};
    cartReservation.time_slots.forEach((timeSlot) => {
      if (timeSlotsByDates[timeSlot.schedule_day.date]) {
        timeSlotsByDates[timeSlot.schedule_day.date].push(timeSlot);
      } else {
        timeSlotsByDates[timeSlot.schedule_day.date] = [timeSlot];
      }
    });

    // loop grouped timeSlots
    Object.entries(timeSlotsByDates).forEach(([date, timeSlots]) => {
      const currDate = getCurrentDateInSloTimezone();
      currDate.setHours(0, 0, 0, 0);
      const timeSlotDate = new Date(date);
      timeSlotDate.setHours(0, 0, 0, 0);

      currDate.setDate(
        currDate.getDate() + institution.days_in_advance_to_reserve
      );

      // check if date is < curr + days_in_advance_to_reserve
      if (currDate.getTime() < timeSlotDate.getTime()) {
        error = `Cannot reserve slots that much advance in the future`;
        return;
      }

      // check if amount of slots is < total_reservations_per_day
      if (timeSlots.length > institution.total_reservations_per_day) {
        error = `Cannot reserve more than ${institution.total_reservations_per_day} slots per day`;
        return;
      }
    });
  } catch (err) {
    error = "Something weird went wrong during default plan validation";
  }

  return { error };
};

const removePlanReservations = async (
  req: any,
  context: any,
  schema: any,
  userPlan: any,
  cartReservation: any
) => {
  let error = null;

  const { ItemsService } = context.services;
  const plansUsersService = new ItemsService("plans_directus_users", {
    schema: schema,
  });

  try {
    // user will have no more reservations left, delete the relation
    if (userPlan.total_reservations - cartReservation.time_slots.length <= 0) {
      await plansUsersService.deleteOne(userPlan.id);
    } else {
      // only decrease total_reservations count
      await plansUsersService.updateOne(userPlan.id, {
        total_reservations:
          userPlan.total_reservations - cartReservation.time_slots.length,
      });
    }
  } catch (err) {
    error = "Something went wrong while removing plan reservations";
  }

  return { error };
};

const reserveTimeSlots = async (
  req: any,
  context: any,
  schema: any,
  cartReservation: any
) => {
  let timeSlots = null;
  let error = null;

  const { ItemsService } = context.services;
  const timeSlotsService = new ItemsService("time_slots", {
    schema: schema,
  });

  try {
    timeSlots = await timeSlotsService.updateMany(
      cartReservation.time_slots.map((timeSlot) => timeSlot.id),
      {
        status: "unavailable",
        booked_by_user: req.accountability?.user,
        cart_reservation: null,
      }
    );
  } catch (err) {
    error = err;
  }

  return { timeSlots, error };
};

const createBookingTransaction = async (
  req: any,
  context: any,
  schema: any,
  cartReservation: any
) => {
  let transaction = null;
  let error = null;

  const { ItemsService } = context.services;
  const transactionsService = new ItemsService("transactions", {
    schema,
  });

  try {
    transaction = await transactionsService.createOne({
      type: "booking",
      user: req.accountability?.user,
      time_slots: cartReservation.time_slots.map((timeSlot) => ({
        time_slots_id: timeSlot.id,
      })),
      status: "success",
    });
  } catch (err) {
    error = err;
  }

  return { transaction, error };
};

const niceError = (res: any, status: number, message: any) => {
  return res.status(status).send(message);
};

const getCurrentDateInSloTimezone = () => {
  // Create an Intl.DateTimeFormat object for Slovenia
  const options = {
    timeZone: "Europe/Ljubljana",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  };
  const formatter = new Intl.DateTimeFormat("en-US", options);

  // Get the current date and time in Slovenia
  const parts = formatter.formatToParts(new Date());

  // Extract the components from the formatted date
  const getPart = (type) => parts.find((part) => part.type === type).value;

  // Construct a string in the format 'YYYY-MM-DDTHH:mm:ss' for easier parsing
  const dateTimeString = `${getPart("year")}-${getPart("month")}-${getPart(
    "day"
  )}T${getPart("hour")}:${getPart("minute")}:${getPart("second")}`;

  // Parse the string back into a Date object (in local time)
  const slovenianDate = new Date(dateTimeString);

  return slovenianDate;
};
