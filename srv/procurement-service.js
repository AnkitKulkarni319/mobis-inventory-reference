const cds = require('@sap/cds');

module.exports = cds.service.impl(async function () {
  const {
    PurchaseRequisitions,
    PurchaseRequisitionItems,
    PurchaseOrders,
    PurchaseOrderItems,
    GoodsReceipts,
    GoodsReceiptItems,
    Suppliers,
    AlertNotifications,
  } = this.entities;

  const { Inventory, StockMovements, ApplicationLogs } = cds.entities('mobis.db');

  
  // submitPR — enforces "mandatory information, required quantity"
  // from your spec. Real procurement-rule checks (budget, category
  // approval matrix) would plug in here as additional guard clauses.
  
  this.on('submitPR', async (req) => {
    const { prID } = req.data;
    const tx = cds.transaction(req);

    const pr = await tx.run(
      SELECT.one.from(PurchaseRequisitions).where({ ID: prID }).columns('ID', 'status', 'location_ID')
    );
    if (!pr) return req.error(404, `PR ${prID} not found.`);
    if (pr.status !== 'DRAFT') return req.error(409, `PR is in status ${pr.status}, cannot submit.`);

    const items = await tx.run(SELECT.from(PurchaseRequisitionItems).where({ pr_ID: prID }));
    if (!items.length) return req.error(400, 'PR must have at least one item.');

    for (const item of items) {
      if (!item.requiredQty || item.requiredQty <= 0) {
        return req.error(400, `Item ${item.ID} has an invalid required quantity.`);
      }
      if (item.supplier_ID) {
        const supplier = await tx.run(SELECT.one.from(Suppliers).where({ ID: item.supplier_ID }));
        if (!supplier?.isEligible) {
          return req.error(400, `Supplier for item ${item.ID} is not eligible for procurement.`);
        }
      }
    }

    await tx.run(UPDATE(PurchaseRequisitions).set({ status: 'SUBMITTED' }).where({ ID: prID }));

    // Notify approvers — in a real build this becomes a Workflow service
    // task (SAP Build Process Automation) rather than a plain alert row.
    await tx.run(
      INSERT.into(AlertNotifications).entries({
        alertType: 'PR_APPROVAL_PENDING',
        location_ID: pr.location_ID,
        message: `PR ${prID} submitted and awaiting approval.`,
        severity: 'MEDIUM',
      })
    );

    return SELECT.one.from(PurchaseRequisitions).where({ ID: prID });
  });

  this.on('approvePR', async (req) => {
    const { prID, approver } = req.data;
    const tx = cds.transaction(req);

    const pr = await tx.run(SELECT.one.from(PurchaseRequisitions).where({ ID: prID }));
    if (!pr) return req.error(404, `PR ${prID} not found.`);
    if (pr.status !== 'SUBMITTED') return req.error(409, `PR must be SUBMITTED to approve, currently ${pr.status}.`);

    await tx.run(
      UPDATE(PurchaseRequisitions)
        .set({ status: 'APPROVED', approvedBy: approver, approvedAt: new Date().toISOString() })
        .where({ ID: prID })
    );

    return SELECT.one.from(PurchaseRequisitions).where({ ID: prID });
  });

  this.on('rejectPR', async (req) => {
    const { prID, approver, reason } = req.data;
    const tx = cds.transaction(req);

    const pr = await tx.run(SELECT.one.from(PurchaseRequisitions).where({ ID: prID }));
    if (!pr) return req.error(404, `PR ${prID} not found.`);
    if (pr.status !== 'SUBMITTED') return req.error(409, `PR must be SUBMITTED to reject, currently ${pr.status}.`);

    await tx.run(
      UPDATE(PurchaseRequisitions)
        .set({ status: 'REJECTED', approvedBy: approver, approvedAt: new Date().toISOString(), rejectionReason: reason })
        .where({ ID: prID })
    );

    return SELECT.one.from(PurchaseRequisitions).where({ ID: prID });
  });

  // createPOFromPR — groups approved PR items by supplier and creates
  // one PO per supplier (a single PR can legitimately fan out to
  // multiple suppliers — e.g. brake pads from Supplier A, ECUs from
  // Supplier B). This mirrors how S/4HANA MM would split a PR into
  // multiple POs during source determination.
  this.on('createPOFromPR', async (req) => {
    const { prID } = req.data;
    const tx = cds.transaction(req);

    const pr = await tx.run(SELECT.one.from(PurchaseRequisitions).where({ ID: prID }));
    if (!pr) return req.error(404, `PR ${prID} not found.`);
    if (pr.status !== 'APPROVED') return req.error(409, `PR must be APPROVED to convert to PO, currently ${pr.status}.`);

    const items = await tx.run(SELECT.from(PurchaseRequisitionItems).where({ pr_ID: prID }));
    if (!items.length) return req.error(400, 'PR has no items to convert.');

    const itemsBySupplier = items.reduce((acc, item) => {
      const key = item.supplier_ID || 'UNASSIGNED';
      (acc[key] ||= []).push(item);
      return acc;
    }, {});

    if (itemsBySupplier.UNASSIGNED) {
      return req.error(400, 'All PR items must have a supplier assigned before PO creation.');
    }

    const createdPOs = [];
    for (const [supplierID, supplierItems] of Object.entries(itemsBySupplier)) {
      const supplier = await tx.run(SELECT.one.from(Suppliers).where({ ID: supplierID }));
      if (!supplier?.isEligible) {
        return req.error(400, `Supplier ${supplierID} is not eligible for procurement.`);
      }

      const poNumber = `PO-${Date.now()}-${supplierID.slice(0, 4)}`;
      await tx.run(
        INSERT.into(PurchaseOrders).entries({
          poNumber,
          supplier_ID: supplierID,
          pr_ID: prID,
          status: 'CREATED',
        })
      );
      const { ID: poID } = await tx.run(SELECT.one.from(PurchaseOrders).where({ poNumber }));

      for (const item of supplierItems) {
        await tx.run(
          INSERT.into(PurchaseOrderItems).entries({
            po_ID: poID,
            part_ID: item.part_ID,
            orderedQty: item.requiredQty,
            unitPrice: item.estimatedPrice,
          })
        );
      }
      createdPOs.push(await tx.run(SELECT.one.from(PurchaseOrders).where({ ID: poID })));
    }

    await tx.run(UPDATE(PurchaseRequisitions).set({ status: 'CONVERTED' }).where({ ID: prID }));

    // --- S/4HANA integration hook (Section 5 of the roadmap) ---
    // await S4Connector.replicatePO(createdPOs);  // via BTP Destination service

    return createdPOs;
  });

  // postGoodsReceipt — validates the PO, updates receivedQty per item,
  // increases Inventory, and rolls the PO status forward. This is the
  // exact "20 brake pads + 100 received = 120" scenario from your spec.
  this.on('postGoodsReceipt', async (req) => {
    const { poID, locationID, receivedBy, items } = req.data;
    const tx = cds.transaction(req);

    const po = await tx.run(SELECT.one.from(PurchaseOrders).where({ ID: poID }));
    if (!po) return req.error(404, `PO ${poID} not found.`);
    if (!['CREATED', 'SENT', 'PARTIALLY_RECEIVED'].includes(po.status)) {
      return req.error(409, `PO is in status ${po.status} and cannot receive goods.`);
    }
    if (!items?.length) return req.error(400, 'At least one receipt line is required.');

    const grNumber = `GR-${Date.now()}`;
    await tx.run(
      INSERT.into(GoodsReceipts).entries({
        grNumber,
        po_ID: poID,
        location_ID: locationID,
        receivedBy,
      })
    );
    const { ID: grID } = await tx.run(SELECT.one.from(GoodsReceipts).where({ grNumber }));

    let allItemsFullyReceived = true;

    for (const line of items) {
      const poItem = await tx.run(SELECT.one.from(PurchaseOrderItems).where({ ID: line.poItemID }));
      if (!poItem || poItem.po_ID !== poID) {
        return req.error(400, `PO item ${line.poItemID} does not belong to PO ${poID}.`);
      }
      if (!(line.receivedQty > 0)) {
        return req.error(400, `Received quantity for item ${line.poItemID} must be positive.`);
      }

      const newReceivedQty = (poItem.receivedQty || 0) + line.receivedQty;
      if (newReceivedQty > poItem.orderedQty) {
        return req.error(
          400,
          `Received quantity (${newReceivedQty}) exceeds ordered quantity (${poItem.orderedQty}) for item ${line.poItemID}.`
        );
      }

      await tx.run(
        INSERT.into(GoodsReceiptItems).entries({
          gr_ID: grID,
          poItem_ID: line.poItemID,
          receivedQty: line.receivedQty,
        })
      );
      await tx.run(
        UPDATE(PurchaseOrderItems).set({ receivedQty: newReceivedQty }).where({ ID: line.poItemID })
      );

      // --- Inventory increment: same Inventory table InventoryService writes to.
      const existingInv = await tx.run(
        SELECT.one.from(Inventory).where({ part_ID: poItem.part_ID, location_ID: locationID })
      );
      if (existingInv) {
        await tx.run(
          UPDATE(Inventory)
            .set({
              quantityOnHand: existingInv.quantityOnHand + line.receivedQty,
              lastMovementAt: new Date().toISOString(),
            })
            .where({ part_ID: poItem.part_ID, location_ID: locationID })
        );
      } else {
        await tx.run(
          INSERT.into(Inventory).entries({
            part_ID: poItem.part_ID,
            location_ID: locationID,
            quantityOnHand: line.receivedQty,
            lastMovementAt: new Date().toISOString(),
          })
        );
      }

      await tx.run(
        INSERT.into(StockMovements).entries({
          movementType: 'RECEIPT',
          part_ID: poItem.part_ID,
          toLocation_ID: locationID,
          quantity: line.receivedQty,
          reference: po.poNumber,
          status: 'POSTED',
        })
      );

      if (newReceivedQty < poItem.orderedQty) allItemsFullyReceived = false;
    }

    await tx.run(
      UPDATE(PurchaseOrders)
        .set({ status: allItemsFullyReceived ? 'RECEIVED' : 'PARTIALLY_RECEIVED' })
        .where({ ID: poID })
    );

    return SELECT.one.from(GoodsReceipts).where({ ID: grID });
  });

  this.on('resolveAlert', async (req) => {
    const { alertID } = req.data;
    await UPDATE(AlertNotifications).set({ isResolved: true }).where({ ID: alertID });
    return SELECT.one.from(AlertNotifications).where({ ID: alertID });
  });

  // Error-recovery hook: if any handler above throws unexpectedly
  // (not a req.error, but a genuine runtime exception — e.g. DB
  // connection drop), log it so it's not silently swallowed. This is
  // what your spec calls "the application records the technical error
  // through application logging."
  this.after('error', '*', async (err, req) => {
    await INSERT.into(ApplicationLogs).entries({
      layer: 'ProcurementService',
      operation: req.event,
      message: err.message,
      severity: 'ERROR',
    });
  });
});