import { defineHook } from "@directus/extensions-sdk";

type CartsSlotsCreateInput = {
  event: string;
  payload: {
    slots_id: string;
    carts_id: string;
  };
  key: number;
  collection: string;
};

type CartsSlotsDeleteInput = {
  event: string;
  payload: number[];
  keys: number[];
  collection: string;
};

export default defineHook(
  ({ filter, action }, { services, logger, getSchema }) => {
    const { ItemsService } = services;

    action(
      "carts_slots.items.create",
      // @ts-ignore
      async (input: CartsSlotsCreateInput, context) => {
        const schema = await getSchema();

        // verify slot if it should be available or not
        verifySlot(schema, input.payload.slots_id, "create");
      }
    );

    // we need to use FILTER hook, otherwise we cant find out which slot was removed from the cart
    filter(
      "carts_slots.items.delete",
      // @ts-ignore
      async (ids, context) => {
        const schema = await getSchema();
        const slotsService = new ItemsService("slots", {
          schema: schema,
        });

        // get deleted slots
        const [slots, readError] = await tryCatcher<any[]>(
          slotsService.readByQuery({
            fields: ["id"],
            filter: {
              carts: {
                id: {
                  _in: ids,
                },
              },
            },
          })
        );
        if (readError) {
          logger.error(
            `Something went wrong while reading carts_slots(${ids}): ${readError}`
          );
        }

        // verify each slot if it should be available or not
        slots?.forEach(async (slot) => {
          await verifySlot(schema, slot.id, "delete");
        });
      }
    );

    const verifySlot = async (
      schema: any,
      slotID: any,
      action: "create" | "delete"
    ) => {
      const slotsService = new ItemsService("slots", {
        schema: schema,
      });

      const [slot, readError] = await tryCatcher<any | null>(
        slotsService.readOne(slotID, {
          fields: ["id", "capacity", "users", "carts"],
        })
      );
      if (readError) {
        logger.error(
          `Something went wrong while reading slot(${slotID}) on carts_slots.items hook: ${readError}`
        );
        return;
      } else if (!slot) return;

      let available: null | true | false = null;
      if (
        action == "create" &&
        slot.users?.length + slot.carts?.length >= slot.capacity
      ) {
        // slot cannot be reserved anymore
        available = false;
      } else if (
        action == "delete" &&
        slot.users?.length + (slot.carts?.length - 1) < slot.capacity // we need -1, because in current stage this deleted relation between carts-slots still exists (cuz its a FILTER hook)
      ) {
        // allow slot to be reservable again
        available = true;
      }

      if (available != null) {
        const [_, updateError] = await tryCatcher(
          slotsService.updateOne(slot.id, { available: available })
        );
        if (updateError) {
          logger.error(
            `Something went wrong while setting available to false on the slot (carts_slots create action): ${updateError}`
          );
          return;
        }
      }
    };
  }
);

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
