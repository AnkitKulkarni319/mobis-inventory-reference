const cds = require('@sap/cds');
const {executeHttpRequest}=require('@sap-cloud-sdk/http-client')
module.exports = cds.service.impl(async function () {
  const DESTINATION_NAME='Mobis_Inventory_BPA'
  const WORKFLOW_DEFINITION_ID='us10.3c318b49trial.mobisinventory3.managerApproval';
  const { SpareParts, Locations, Inventory, StockMovements, AlertNotifications,StockTransferRequests } =
    this.entities;
  // ApplicationLogs lives in the db namespace, not exposed via this service's
  // API, so we reach it through the CDS reflection model rather than
  // this.entities (which only lists entities this service projects).
  const { ApplicationLogs } = cds.entities('mobis.db');

  // Shared helper: fetch (or lazily create) the Inventory row for a
  // part/location pair. In enterprise MM terms this is the equivalent of
  // reading MARD (storage-location stock) before posting a material doc.
  async function getInventoryRow(tx, partID, locationID) {
    let row = await tx.run(
      SELECT.one.from(Inventory).where({ part_ID: partID, location_ID: locationID })
    );
    if (!row) {
      // First movement ever for this part at this location — initialize at 0
      // rather than erroring, since "no row yet" and "zero stock" are the
      // same business fact.
      await tx.run(
        INSERT.into(Inventory).entries({ part_ID: partID, location_ID: locationID, quantityOnHand: 0 })
      );
      row = { part_ID: partID, location_ID: locationID, quantityOnHand: 0, reorderLevel: null };
    }
    return row;
  }

  async function raiseLowStockAlertIfNeeded(tx, part, locationID, newQty) {
    const effectiveReorderLevel =
      (await tx.run(SELECT.one.from(Inventory).where({ part_ID: part.ID, location_ID: locationID })))
        ?.reorderLevel ?? part.reorderLevel;

    if (newQty < effectiveReorderLevel) {
      await tx.run(
        INSERT.into(AlertNotifications).entries({
          alertType: 'LOW_STOCK',
          part_ID: part.ID,
          location_ID: locationID,
          message: `Part ${part.partNumber} at location fell to ${newQty}, below reorder level ${effectiveReorderLevel}.`,
          severity: newQty <= (part.safetyStock ?? 0) ? 'HIGH' : 'MEDIUM',
        })
      );
    }
  }

  // issueStock — validations mirror your spec exactly:
  //   1. part exists   2. location exists   3. qty > 0
  //   4. sufficient available stock (never allow negative inventory)
  this.on('issueStock', async (req) => {
    const { partID, locationID, quantity, reference } = req.data;
    const tx = cds.transaction(req);

    if (!(quantity > 0)) {
      return req.error(400, 'Quantity must be a positive number.');
    }

    const part = await tx.run(SELECT.one.from(SpareParts).where({ ID: partID }));
    if (!part) return req.error(404, `Spare part ${partID} does not exist.`);

    const location = await tx.run(SELECT.one.from(Locations).where({ ID: locationID }));
    if (!location) return req.error(404, `Location ${locationID} does not exist.`);

    const invRow = await getInventoryRow(tx, partID, locationID);
    if (invRow.quantityOnHand < quantity) {
      // Log the failed attempt — this is what your spec calls "application logging"
      await tx.run(
        INSERT.into(ApplicationLogs).entries({
          layer: 'InventoryService',
          operation: 'issueStock',
          message: `Insufficient stock: requested ${quantity}, available ${invRow.quantityOnHand} for part ${partID} at ${locationID}.`,
          severity: 'WARNING',
        })
      );
      return req.error(
        409,
        `Insufficient stock. Available: ${invRow.quantityOnHand}, requested: ${quantity}.`
      );
    }

    const newQty = invRow.quantityOnHand - quantity;

    await tx.run(
      UPDATE(Inventory)
        .set({ quantityOnHand: newQty, lastMovementAt: new Date().toISOString() })
        .where({ part_ID: partID, location_ID: locationID })
    );

    await tx.run(
      INSERT.into(StockMovements).entries({
        movementType: 'ISSUE',
        part_ID: partID,
        fromLocation_ID: locationID,
        quantity,
        reference,
        status: 'POSTED',
      })
    );

    await raiseLowStockAlertIfNeeded(tx, part, locationID, newQty);

    return SELECT.one.from(StockMovements).where({ part_ID: partID, reference });
  });

  // transferStock — same guard rails as issue, applied to the SOURCE
  // location, plus a mandatory increment on the TARGET location.
  // Modeled as ONE ledger row with both fromLocation and toLocation set,
  // not two rows — this preserves the semantic "this was one transfer",
  // which matters when you reconcile movements later.
  this.on('transferStock', async (req) => {
    const { partID, fromLocationID, toLocationID, quantity, reference } = req.data;
    const tx = cds.transaction(req);

    if (!(quantity > 0)) return req.error(400, 'Quantity must be positive.');
    if (fromLocationID === toLocationID)
      return req.error(400, 'Source and target location must differ.');

    const part = await tx.run(SELECT.one.from(SpareParts).where({ ID: partID }));
    if (!part) return req.error(404, `Spare part ${partID} does not exist.`);

    for (const locID of [fromLocationID, toLocationID]) {
      const loc = await tx.run(SELECT.one.from(Locations).where({ ID: locID }));
      if (!loc) return req.error(404, `Location ${locID} does not exist.`);
    }

    const sourceRow = await getInventoryRow(tx, partID, fromLocationID);
    if (sourceRow.quantityOnHand < quantity) {
      return req.error(
        409,
        `Insufficient stock at source. Available: ${sourceRow.quantityOnHand}, requested: ${quantity}.`
      );
    }
    const targetRow = await getInventoryRow(tx, partID, toLocationID);

    const newSourceQty = sourceRow.quantityOnHand - quantity;
    const newTargetQty = targetRow.quantityOnHand + quantity;
    const now = new Date().toISOString();

    await tx.run(
      UPDATE(Inventory)
        .set({ quantityOnHand: newSourceQty, lastMovementAt: now })
        .where({ part_ID: partID, location_ID: fromLocationID })
    );
    await tx.run(
      UPDATE(Inventory)
        .set({ quantityOnHand: newTargetQty, lastMovementAt: now })
        .where({ part_ID: partID, location_ID: toLocationID })
    );

    await tx.run(
      INSERT.into(StockMovements).entries({
        movementType: 'TRANSFER',
        part_ID: partID,
        fromLocation_ID: fromLocationID,
        toLocation_ID: toLocationID,
        quantity,
        reference,
        status: 'POSTED',
      })
    );

    await raiseLowStockAlertIfNeeded(tx, part, fromLocationID, newSourceQty);

    return SELECT.one
      .from(StockMovements)
      .where({ part_ID: partID, fromLocation_ID: fromLocationID, toLocation_ID: toLocationID })
      .orderBy('createdAt desc');
  });

  this.on('getAvailableStock', async (req) => {
    const { partID, locationID } = req.data;
    const row = await SELECT.one.from(Inventory).where({ part_ID: partID, location_ID: locationID });
    return row ? row.quantityOnHand : 0;
  });


  this.on('CREATE','StockTransferRequests',async(req)=>{
    const {part_ID,fromLocation_ID,toLocation_ID,quantity}=req.data;
    const tx=cds.transaction(req);
const requestId = req.data.ID || cds.utils.uuid();
req.data.ID = requestId;
req.data.requestedBy = req.data.requestedBy || 'admin';
      if (quantity <= 0) {
    return req.error(400, 'Quantity must be positive.');
  }
  if (fromLocation_ID === toLocation_ID) {
    return req.error(400, 'Source and target locations must be different.');
  }
 const part = await tx.run(
    SELECT.one.from(SpareParts).where({ ID: part_ID })
  );

  if (!part) {
    return req.error(404, 'Spare part does not exist.');
  }


  const fromLocation = await tx.run(
    SELECT.one.from(Locations).where({ ID: fromLocation_ID })
  );

  if (!fromLocation) {
    return req.error(404, 'Source location does not exist.');
  }

 const toLocation = await tx.run(
    SELECT.one.from(Locations).where({ ID: toLocation_ID })
  );

  if (!toLocation) {
    return req.error(404, 'Target location does not exist.');
  }

    const sourceStock = await getInventoryRow(
    tx,
    part_ID,
    fromLocation_ID
  );

  if (sourceStock.quantityOnHand < quantity) {
    return req.error(409, 'Insufficient stock at source location.');
  }

   req.data.status = 'PENDING';

await tx.run(
  INSERT.into('mobis.db.StockTransferRequests').entries(req.data)
);

console.log("ABOUT TO CALL BPA");

const response = await executeHttpRequest(
  {
    destinationName: DESTINATION_NAME,
  },
  {
    method: 'POST',
    url: '/workflow/rest/v1/workflow-instances',
    data: {
      definitionId: WORKFLOW_DEFINITION_ID,
      context: {
        st_requestId: requestId,
        st_sparePart: part.partNumber + ' - ' + part.description,
        st_sourceLocation: fromLocation.name,
        st_destinationLocation: toLocation.name,
        st_quantity: req.data.quantity,
        st_requestedBy: req.data.requestedBy,
        st_requestStatus: req.data.status
      }
    },
    headers: {
      'Content-Type': 'application/json'
    }
  }
);

console.log("BPA RESPONSE", response.status);

return req.data;



return req.data;
  })


this.on('approveStockTransferRequest', async (req) => {

    const ID = req.params[0].ID;

    const tx = cds.transaction(req);

    // Get the transfer request
    const transferRequest = await tx.run(
        SELECT.one
            .from('mobis.db.StockTransferRequests')
            .where({ ID })
    );

    if (!transferRequest) {
        return req.error(404, 'Stock transfer request not found.');
    }

    // Request must be pending
    if (transferRequest.status !== 'PENDING') {
        return req.error(400, 'Only pending requests can be approved.');
    }

    const {
        part_ID,
        fromLocation_ID,
        toLocation_ID,
        quantity
    } = transferRequest;

    // Check source inventory
    const sourceInventory = await tx.run(
        SELECT.one
            .from('mobis.db.Inventory')
            .where({
                part_ID,
                location_ID: fromLocation_ID
            })
    );

    if (!sourceInventory || sourceInventory.quantityOnHand < quantity) {
        return req.error(400, 'Insufficient stock at source location.');
    }

    // Reduce source stock
    await tx.run(
        UPDATE('mobis.db.Inventory')
            .set({
                quantityOnHand: { '-=': quantity }
            })
            .where({
                part_ID,
                location_ID: fromLocation_ID
            })
    );

    // Check destination inventory
    const destinationInventory = await tx.run(
        SELECT.one
            .from('mobis.db.Inventory')
            .where({
                part_ID,
                location_ID: toLocation_ID
            })
    );

    if (destinationInventory) {

        await tx.run(
            UPDATE('mobis.db.Inventory')
                .set({
                    quantityOnHand: { '+=': quantity }
                })
                .where({
                    part_ID,
                    location_ID: toLocation_ID
                })
        );

    } else {

        await tx.run(
            INSERT.into('mobis.db.Inventory').entries({
                part_ID,
                location_ID: toLocation_ID,
                quantityOnHand: quantity
            })
        );
    }

    await tx.run(
        INSERT.into('mobis.db.StockMovements').entries({
            part_ID,
            fromLocation_ID,
            toLocation_ID,
            quantity,
            movementType: 'TRANSFER'
        })
    );

    
    await tx.run(
        UPDATE('mobis.db.StockTransferRequests')
            .set({
                status: 'Approved'
            })
            .where({ ID })
    );

    return 'Stock transfer approved successfully.';
});


this.on('rejectStockTransferRequest', 'StockTransferRequests', async (req) => {
    const { rejectionReason } = req.data;
    const requestID = req.params[0].ID;

    if (!rejectionReason || !rejectionReason.trim()) {
        return req.error(400, 'Rejection reason is required.');
    }

    const tx = cds.transaction(req);

    const request = await tx.run(
        SELECT.one.from('mobis.db.StockTransferRequests')
            .where({ ID: requestID })
    );

    if (!request) {
        return req.error(404, 'Stock transfer request not found.');
    }

    if (request.status !== 'PENDING') {
        return req.error(
            400,
            `Only PENDING requests can be rejected. Current status: ${request.status}`
        );
    }

    await tx.run(
        UPDATE('mobis.db.StockTransferRequests')
            .set({
                status: 'Rejected',
                rejectionReason: rejectionReason.trim()
            })
            .where({ ID: requestID })
    );

    return 'Stock transfer request rejected successfully.';
});


this.on('generateDailyInventorySummary', async (req) => {

  const tx = cds.transaction(req);

  const now = new Date();

  // Current calendar day
  const startOfDay = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate()
    )
  );

  const endOfDay = new Date(startOfDay);
  endOfDay.setUTCDate(endOfDay.getUTCDate() + 1);

  // Get POSTED movements
  const movements = await tx.run(
    SELECT.from('mobis.db.StockMovements')
      .where({ status: 'POSTED' })
  );

  // Keep only today's ISSUE and TRANSFER movements
  const dailyMovements = movements.filter(m => {

    const movementDate = new Date(m.createdAt);

    return movementDate >= startOfDay &&
           movementDate < endOfDay &&
           (m.movementType === 'ISSUE' ||
            m.movementType === 'TRANSFER');
  });

  const summary = {
    date: startOfDay.toISOString().slice(0, 10),

    totalMovements: dailyMovements.length,

    issueCount: dailyMovements.filter(
      m => m.movementType === 'ISSUE'
    ).length,

    transferCount: dailyMovements.filter(
      m => m.movementType === 'TRANSFER'
    ).length,

    totalQuantityMoved: dailyMovements.reduce(
      (total, m) => total + (m.quantity || 0),
      0
    )
  };

  await tx.run(
    INSERT.into(ApplicationLogs).entries({
      layer: 'InventoryService',
      operation: 'generateDailyInventorySummary',
      message: JSON.stringify(summary),
      severity: 'INFO'
    })
  );

  return JSON.stringify(summary);
});



});
