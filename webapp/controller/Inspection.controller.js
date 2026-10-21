sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/MessageToast",
    "sap/m/MessageBox"
], function (
    Controller,
    JSONModel,
    Filter,
    FilterOperator,
    MessageToast,
    MessageBox
) {
    "use strict";

    return Controller.extend("inventorytest.controller.Inspection", {

        onInit: function () {

            this.getView().setModel(
                new JSONModel({
                    items: [],
                    selected: null,
                    returnQty: ""
                }),
                "insp"
            );

            this.getOwnerComponent()
                .getRouter()
                .getRoute("inspection")
                .attachPatternMatched(this._onRouteMatched, this);
        },


        _onRouteMatched: function () {

            this._clearSelection();
            this._loadItems();
        },


        // ================================================================
        // DATA LOADING
        // "Kept for inspection" = defectiveReturnedQuantity > 0 on a
        // service issue (this is what the Reconcile dialog records).
        // ================================================================

        _loadItems: async function () {

            let oBinding;

            try {

                const oModel = this.getOwnerComponent().getModel();

                oBinding = oModel.bindList(
                    "/ServicePartIssues",
                    null,
                    null,
                    [new Filter("defectiveReturnedQuantity", FilterOperator.GT, 0)],
                    {
                        "$expand": "serviceCenter,part,warehouse",
                        "$orderby": "issueDate desc"
                    }
                );

                const aContexts = await oBinding.requestContexts(0, 500);

                const aItems = aContexts.map(function (oContext) {

                    const oData = oContext.getObject();

                    const oCenter = oData.serviceCenter || {};
                    const oPart = oData.part || {};
                    const oWarehouse = oData.warehouse || {};

                    return {
                        ID: oData.ID,
                        partID: oData.part_ID || oPart.ID,
                        warehouseID: oData.warehouse_ID || oWarehouse.ID,
                        serviceCenter: oCenter.name || "",
                        serviceCenterCode: oCenter.serviceCenterCode || "",
                        partNumber: oPart.partNumber || "",
                        description: oPart.description || "",
                        warehouse: oWarehouse.name || "",
                        issuedQuantity: oData.issuedQuantity || 0,
                        consumedQuantity: oData.consumedQuantity || 0,
                        unusedReturnedQuantity: oData.unusedReturnedQuantity || 0,
                        defectiveQuantity: oData.defectiveReturnedQuantity || 0,
                        reference: oData.remarks || "",
                        dateTime: this._formatDateTime(oData.issueDate)
                    };

                }, this);

                this.getView()
                    .getModel("insp")
                    .setProperty("/items", aItems);

            } catch (oError) {

                console.error("Error loading inspection items:", oError);

            } finally {

                if (oBinding) {
                    oBinding.destroy();
                }
            }
        },


        _formatDateTime: function (sDate) {

            if (!sDate) {
                return "";
            }

            try {

                return new Intl.DateTimeFormat(
                    undefined,
                    {
                        year: "numeric",
                        month: "short",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit"
                    }
                ).format(new Date(sDate));

            } catch (e) {

                return sDate;
            }
        },


        onRefresh: function () {

            this._loadItems();
        },


        // ================================================================
        // SELECTION / DETAILS
        // ================================================================

        onItemPress: function (oEvent) {

            const oItem = oEvent.getSource()
                .getBindingContext("insp")
                .getObject();

            const oInsp = this.getView().getModel("insp");

            oInsp.setProperty("/selected", Object.assign({}, oItem));
            oInsp.setProperty("/returnQty", String(oItem.defectiveQuantity));
        },


        _clearSelection: function () {

            const oInsp = this.getView().getModel("insp");

            oInsp.setProperty("/selected", null);
            oInsp.setProperty("/returnQty", "");
        },


        onCloseDetails: function () {

            this._clearSelection();
        },


        // ================================================================
        // RETURN TO WAREHOUSE
        // ================================================================

        onReturnToWarehouse: function () {

            const oInsp = this.getView().getModel("insp");
            const oSelected = oInsp.getProperty("/selected");

            if (!oSelected) {
                return;
            }

            const nQty = Number(oInsp.getProperty("/returnQty"));

            if (!Number.isInteger(nQty) || nQty <= 0) {

                MessageBox.error("Please enter a valid whole-number quantity.");
                return;
            }

            if (nQty > oSelected.defectiveQuantity) {

                MessageBox.error(
                    "You can return at most " +
                    oSelected.defectiveQuantity + " unit(s)."
                );

                return;
            }

            MessageBox.confirm(
                "Return " + nQty + " unit(s) of " + oSelected.partNumber +
                " to " + oSelected.warehouse + " stock?",
                {
                    title: "Return to Warehouse",
                    actions: [MessageBox.Action.OK, MessageBox.Action.CANCEL],
                    emphasizedAction: MessageBox.Action.OK,
                    onClose: function (sAction) {

                        if (sAction === MessageBox.Action.OK) {
                            this._executeReturn(oSelected, nQty);
                        }

                    }.bind(this)
                }
            );
        },


        // Moves N units from "defective / kept for inspection" back into
        // warehouse stock, using one batch so all three changes succeed or
        // fail together:
        //   ServicePartIssues.defectiveReturnedQuantity  - N
        //   ServicePartIssues.unusedReturnedQuantity     + N
        //   Inventory.quantityOnHand                     + N
               // Calls the service action "returnFromInspection", which updates
        // the service issue and the warehouse stock on the server.
        _executeReturn: async function (oSelected, nQty) {

            const oView = this.getView();

            oView.setBusy(true);

            try {

                const oAction = this.getOwnerComponent()
                    .getModel()
                    .bindContext("/returnFromInspection(...)");

                oAction.setParameter("issueID", oSelected.ID);
                oAction.setParameter("quantity", nQty);

                await oAction.execute();

                MessageToast.show(
                    nQty + " unit(s) returned to warehouse. Inventory updated."
                );

                this._clearSelection();

                await this._loadItems();

            } catch (oError) {

                console.error("Return from inspection error:", oError);

                MessageBox.error(
                    (oError && oError.message) ||
                    "Failed to return item to warehouse."
                );

            } finally {

                oView.setBusy(false);
            }
        },

        // ================================================================
        // NAVIGATION
        // ================================================================

        onNavBack: function () {

            this.getOwnerComponent()
                .getRouter()
                .navTo("dashboard");
        }

    });
});