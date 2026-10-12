
sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/m/Dialog",
    "sap/m/Button",
    "sap/m/Label",
    "sap/m/Input",
    "sap/m/Text",
    "sap/m/VBox"
], function (
    Controller,
    JSONModel,
    MessageToast,
    MessageBox,
    Dialog,
    Button,
    Label,
    Input,
    Text,
    VBox
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
                "serviceIssues"
            );

            this._aSpareParts = [];
            this._aInventory = [];

            this._pSpareParts = this._loadSpareParts();
            this._pInventory = this._loadInventory();

            this._loadServiceIssues();
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
                ).format(
                    new Date(sDate)
                );

            } catch (e) {

                return sDate;
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
                await this._loadServiceIssues();

            } catch (oError) {

                console.error("Issue Stock error:", oError);

                MessageBox.error(
                    (oError && oError.message) ||
                    "Failed to issue stock."
                );
            }
        },


        _loadServiceIssues: async function () {

            try {

                const oModel = this.getView().getModel();

                const oBinding = oModel.bindList(
                    "/ServicePartIssues",
                    null,
                    null,
                    null,
                    {
                        "$expand": "serviceCenter,part,warehouse",
                        "$orderby": "issueDate desc"
                    }
                );

                const aContexts = await oBinding.requestContexts(
                    0,
                    50
                );

                const aItems = aContexts.map(function (oContext) {

                    const oData = oContext.getObject();

                    const oCenter = oData.serviceCenter || {};
                    const oPart = oData.part || {};
                    const oWarehouse = oData.warehouse || {};

                    return {
                        ID: oData.ID,
                        serviceCenter: oCenter.name || "",
                        serviceCenterCode: oCenter.serviceCenterCode || "",
                        partNumber: oPart.partNumber || "",
                        description: oPart.description || "",
                        warehouse: oWarehouse.name || "",
                        issuedQuantity: oData.issuedQuantity || 0,
                        consumedQuantity: oData.consumedQuantity || 0,
                        unusedReturnedQuantity: oData.unusedReturnedQuantity || 0,
                        defectiveReturnedQuantity: oData.defectiveReturnedQuantity || 0,
                        status: oData.status || "",
                        dateTime: this._formatDateTime(oData.issueDate)
                    };

                }, this);

                this.getView()
                    .getModel("serviceIssues")
                    .setProperty("/items", aItems);

            } catch (oError) {

                console.error(
                    "Error loading service center issues:",
                    oError
                );
            }
        },


        onRefreshServiceIssues: function () {

            this._loadServiceIssues();
        },


        onReconcilePress: function (oEvent) {

            const oIssue = oEvent.getSource()
                .getBindingContext("serviceIssues")
                .getObject();

            const that = this;

            const oConsumed = new Input({
                type: "Number",
                value: "0",
                width: "100%"
            });

            const oUnused = new Input({
                type: "Number",
                value: "0",
                width: "100%"
            });

            const oDefective = new Input({
                type: "Number",
                value: "0",
                width: "100%"
            });

            const oSummary = new Text({
                text: "Accounted: 0 / " + oIssue.issuedQuantity
            });

            function fnTotal() {

                return (Number(oConsumed.getValue()) || 0) +
                    (Number(oUnused.getValue()) || 0) +
                    (Number(oDefective.getValue()) || 0);
            }

            function fnUpdate() {

                oSummary.setText(
                    "Accounted: " + fnTotal() +
                    " / " + oIssue.issuedQuantity
                );
            }

            oConsumed.attachLiveChange(fnUpdate);
            oUnused.attachLiveChange(fnUpdate);
            oDefective.attachLiveChange(fnUpdate);

            const oDialog = new Dialog({

                title: "Reconcile: " + oIssue.partNumber +
                    " (" + oIssue.serviceCenter + ")",

                content: [
                    new VBox({
                        items: [
                            new Text({
                                text: "Issued quantity: " + oIssue.issuedQuantity
                            }),

                            new Label({
                                text: "Consumed during repair"
                            }),
                            oConsumed,

                            new Label({
                                text: "Unused, returned to warehouse stock"
                            }),
                            oUnused,

                            new Label({
                                text: "Defective, kept for inspection (not added to stock)"
                            }),
                            oDefective,

                            oSummary
                        ]
                    }).addStyleClass("sapUiSmallMargin")
                ],

                beginButton: new Button({

                    text: "Reconcile",
                    type: "Emphasized",

                    press: async function () {

                        const nConsumed = Number(oConsumed.getValue());
                        const nUnused = Number(oUnused.getValue());
                        const nDefective = Number(oDefective.getValue());

                        const aValues = [
                            nConsumed,
                            nUnused,
                            nDefective
                        ];

                        if (!aValues.every(function (n) {
                            return Number.isInteger(n) && n >= 0;
                        })) {

                            MessageBox.error(
                                "Quantities must be whole numbers, zero or more."
                            );

                            return;
                        }

                        if (fnTotal() !== oIssue.issuedQuantity) {

                            MessageBox.error(
                                "Quantities must add up to the issued quantity (" +
                                oIssue.issuedQuantity + ")."
                            );

                            return;
                        }

                        try {

                            const oAction = that.getView()
                                .getModel()
                                .bindContext("/reconcileServiceIssue(...)");

                            oAction.setParameter("issueID", oIssue.ID);
                            oAction.setParameter("consumedQuantity", nConsumed);
                            oAction.setParameter("unusedReturnedQuantity", nUnused);
                            oAction.setParameter("defectiveReturnedQuantity", nDefective);

                            await oAction.execute();

                            oDialog.close();

                            MessageToast.show("Service issue reconciled.");

                            await that._loadInventory();
                            await that._loadServiceIssues();

                        } catch (oError) {

                            console.error("Reconcile error:", oError);

                            MessageBox.error(
                                (oError && oError.message) ||
                                "Failed to reconcile."
                            );
                        }
                    }
                }),

                endButton: new Button({
                    text: "Cancel",
                    press: function () {
                        oDialog.close();
                    }
                }),

                afterClose: function () {
                    oDialog.destroy();
                }
            });

            this.getView().addDependent(oDialog);

            oDialog.open();
        },


        onNavBack: function () {

            this.getOwnerComponent()
                .getRouter()
                .navTo("dashboard");
        }

    });
});
