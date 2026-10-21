sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "sap/m/MessageBox"
], function (
    Controller,
    JSONModel,
    MessageToast,
    MessageBox
) {
    "use strict";

    return Controller.extend("inventorytest.controller.IssueStock", {

        onInit: function () {

            this.getView().setModel(
                this.getOwnerComponent().getModel()
            );

            this.getView().setModel(
                new JSONModel({
                    items: []
                }),
                "issueParts"
            );

            this.getView().setModel(
                new JSONModel({
                    items: []
                }),
                "latestIssues"
            );

            this._aSpareParts = [];
            this._aInventory = [];

            this._pSpareParts = this._loadSpareParts();
            this._pInventory = this._loadInventory();

            this._loadLatestIssues();
        },


        // Latest 3 stock issues (all of them go to a service center).
        _loadLatestIssues: async function () {

            let oBinding;

            try {

                const oModel = this.getView().getModel();

                oBinding = oModel.bindList(
                    "/ServicePartIssues",
                    null,
                    null,
                    null,
                    {
                        "$expand": "serviceCenter,part,warehouse",
                        "$orderby": "issueDate desc"
                    }
                );

                const aContexts = await oBinding.requestContexts(0, 3);

                const aItems = aContexts.map(function (oContext) {

                    const oData = oContext.getObject();

                    const oCenter = oData.serviceCenter || {};
                    const oPart = oData.part || {};
                    const oWarehouse = oData.warehouse || {};

                    return {
                        serviceCenter: oCenter.name || "",
                        serviceCenterCode: oCenter.serviceCenterCode || "",
                        partNumber: oPart.partNumber || "",
                        description: oPart.description || "",
                        warehouse: oWarehouse.name || "",
                        quantity: oData.issuedQuantity || 0,
                        reference: oData.remarks || "",
                        status: oData.status || "",
                        dateTime: this._formatDateTime(oData.issueDate)
                    };

                }, this);

                this.getView()
                    .getModel("latestIssues")
                    .setProperty("/items", aItems);

            } catch (oError) {

                console.error("Error loading latest stock issues:", oError);

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


        onRefreshLatestIssues: function () {

            this._loadLatestIssues();
        },


        _loadSpareParts: async function () {

            try {

                const oModel = this.getView().getModel();

                const oBinding = oModel.bindList("/SpareParts");

                const aContexts = await oBinding.requestContexts(
                    0,
                    10000
                );

                this._aSpareParts = aContexts.map(function (oContext) {
                    return oContext.getObject();
                });

                console.log(
                    "Spare Parts loaded:",
                    this._aSpareParts
                );

            } catch (oError) {

                console.error(
                    "Error loading spare parts:",
                    oError
                );
            }
        },


        _loadInventory: async function () {

            try {

                const oModel = this.getView().getModel();

                const oBinding = oModel.bindList("/Inventory");

                const aContexts = await oBinding.requestContexts(
                    0,
                    10000
                );

                this._aInventory = aContexts.map(function (oContext) {
                    return oContext.getObject();
                });

                console.log(
                    "Inventory loaded:",
                    this._aInventory
                );

            } catch (oError) {

                console.error(
                    "Error loading inventory:",
                    oError
                );
            }
        },


        onLocationChange: async function (oEvent) {

            const sLocationID = oEvent.getSource().getSelectedKey();

            const oIssuePartsModel = this.getView().getModel("issueParts");

            if (!sLocationID) {

                oIssuePartsModel.setProperty("/items", []);

                this.byId("issuePartSelect").setSelectedKey("");

                return;
            }

            await Promise.all([
                this._pSpareParts,
                this._pInventory
            ]);

            const aInventoryForLocation = this._aInventory.filter(
                function (oInventory) {
                    return String(oInventory.location_ID) === String(sLocationID);
                }
            );

            const aPartIDs = aInventoryForLocation.map(
                function (oInventory) {
                    return String(oInventory.part_ID);
                }
            );

            const aFilteredParts = this._aSpareParts.filter(
                function (oPart) {
                    return aPartIDs.includes(String(oPart.ID));
                }
            );

            console.log("Selected Location:", sLocationID);
            console.log("Inventory for Location:", aInventoryForLocation);
            console.log("Filtered Spare Parts:", aFilteredParts);

            oIssuePartsModel.setProperty("/items", aFilteredParts);

            this.byId("issuePartSelect").setSelectedKey("");
        },


        onIssueStock: async function () {

            const oModel = this.getView().getModel();

            const partID = this.byId("issuePartSelect").getSelectedKey();

            const locationID = this.byId("issueLocSelect").getSelectedKey();

            const quantity = Number(
                this.byId("issueQtyInput").getValue()
            );

            const reference = this.byId("issueRefInput").getValue().trim();

            const serviceCenterID = this.byId(
                "issueServiceCenterSelect"
            ).getSelectedKey();

            if (!locationID) {
                MessageBox.error("Please select a From Warehouse.");
                return;
            }

            if (!partID) {
                MessageBox.error("Please select a Spare Part.");
                return;
            }

            if (!(quantity > 0)) {
                MessageBox.error("Please enter a valid quantity.");
                return;
            }

            if (!serviceCenterID) {
                MessageBox.error("Please select a Service Center.");
                return;
            }

            try {

                const oAction = oModel.bindContext("/issueStock(...)");

                oAction.setParameter("partID", partID);
                oAction.setParameter("locationID", locationID);
                oAction.setParameter("quantity", quantity);
                oAction.setParameter("reference", reference);
                oAction.setParameter("serviceCenterID", serviceCenterID);

                await oAction.execute();

                MessageToast.show("Stock issued successfully.");

                this.byId("issueLocSelect").setSelectedKey("");
                this.byId("issuePartSelect").setSelectedKey("");
                this.byId("issueQtyInput").setValue("");
                this.byId("issueRefInput").setValue("");
                this.byId("issueServiceCenterSelect").setSelectedKey("");

                this.getView()
                    .getModel("issueParts")
                    .setProperty("/items", []);

                await this._loadInventory();
                await this._loadLatestIssues();

            } catch (oError) {

                console.error("Issue Stock error:", oError);

                MessageBox.error(
                    (oError && oError.message) ||
                    "Failed to issue stock."
                );
            }
        },


        onGoToServiceCenter: function () {

            this.getOwnerComponent()
                .getRouter()
                .navTo("serviceCenter");
        },


        onNavBack: function () {

            this.getOwnerComponent()
                .getRouter()
                .navTo("dashboard");
        }

    });
});