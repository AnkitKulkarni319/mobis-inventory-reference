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
                    allItems: [],
                    items: [],
                    locations: [],
                    filterParts: []
                }),
                "recentIssues"
            );

            this._aSpareParts = [];
            this._aInventory = [];

            this._sLocationFilter = "";
            this._sPartNumberFilter = "";

            this._pSpareParts = this._loadSpareParts();
            this._pInventory = this._loadInventory();

            this._loadRecentIssues();
        },


        _loadSpareParts: async function () {

            try {

                const oModel =
                    this.getView().getModel();

                const oBinding =
                    oModel.bindList("/SpareParts");

                const aContexts =
                    await oBinding.requestContexts(
                        0,
                        10000
                    );

                this._aSpareParts =
                    aContexts.map(function (oContext) {
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

                const oModel =
                    this.getView().getModel();

                const oBinding =
                    oModel.bindList("/Inventory");

                const aContexts =
                    await oBinding.requestContexts(
                        0,
                        10000
                    );

                this._aInventory =
                    aContexts.map(function (oContext) {
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


        _loadRecentIssues: async function () {

            try {

                const oModel =
                    this.getView().getModel();

                const oBinding = oModel.bindList(
                    "/StockMovements",
                    null,
                    null,
                    null,
                    {
                        "$filter":
                            "movementType eq 'ISSUE' and status eq 'POSTED'",

                        "$expand":
                            "part,fromLocation",

                        "$orderby":
                            "createdAt desc"
                    }
                );

                const aContexts =
                    await oBinding.requestContexts(
                        0,
                        10
                    );

                const aItems =
                    aContexts.map(function (oContext) {

                        const oData =
                            oContext.getObject();

                        const oPart =
                            oData.part || {};

                        const oLocation =
                            oData.fromLocation || {};

                        return {

                            ID:
                                oData.ID,

                            partNumber:
                                oPart.partNumber || "",

                            description:
                                oPart.description || "",

                            location:
                                oLocation.name || "",

                            locationCode:
                                oLocation.locationCode || "",

                            quantity:
                                oData.quantity || 0,

                            reference:
                                oData.reference || "",

                            movementType:
                                oData.movementType || "",

                            status:
                                oData.status || "",

                            dateTime:
                                this._formatDateTime(
                                    oData.createdAt
                                )
                        };

                    }, this);


                const aLocationNames = [
                    ...new Set(
                        aItems
                            .map(function (oItem) {
                                return oItem.location;
                            })
                            .filter(Boolean)
                    )
                ].sort();


                const aLocations =
                    aLocationNames.map(function (sLocation) {

                        return {
                            key: sLocation,
                            text: sLocation
                        };

                    });


                const aFilterParts =
                    this._getPartsForLocation(
                        aItems,
                        ""
                    );


                const oRecentIssuesModel =
                    this.getView()
                        .getModel("recentIssues");


                oRecentIssuesModel.setData({

                    allItems:
                        aItems,

                    items:
                        aItems.slice(),

                    locations:
                        aLocations,

                    filterParts:
                        aFilterParts

                });


                this._applyRecentIssuesFilter();

            } catch (oError) {

                console.error(
                    "Error loading recent stock issues:",
                    oError
                );
            }
        },


        _getPartsForLocation: function (
            aItems,
            sLocation
        ) {

            const sSelectedLocation =
                String(
                    sLocation || ""
                )
                    .trim()
                    .toLowerCase();


            let aFilteredItems;


            if (!sSelectedLocation) {

                aFilteredItems =
                    aItems;

            } else {

                aFilteredItems =
                    aItems.filter(function (oItem) {

                        return String(
                            oItem.location || ""
                        )
                            .trim()
                            .toLowerCase() ===
                            sSelectedLocation;

                    });
            }


            const oParts = {};


            aFilteredItems.forEach(function (oItem) {

                if (
                    oItem.partNumber &&
                    !oParts[oItem.partNumber]
                ) {

                    oParts[oItem.partNumber] = {

                        partNumber:
                            oItem.partNumber,

                        description:
                            oItem.description || ""

                    };
                }
            });


            return Object.values(oParts).sort(
                function (a, b) {

                    return String(
                        a.partNumber
                    ).localeCompare(
                        String(b.partNumber)
                    );

                }
            );
        },


        onIssueFilterLocationChange: function (oEvent) {

            const sLocation =
                oEvent.getSource()
                    .getSelectedKey();


            this._sLocationFilter =
                sLocation || "";


            this._sPartNumberFilter =
                "";


            const oPartSelect =
                this.byId(
                    "issuePartFilterSelect"
                );


            if (oPartSelect) {

                oPartSelect.setSelectedKey("");
            }


            const oModel =
                this.getView()
                    .getModel("recentIssues");


            const aAllItems =
                oModel.getProperty(
                    "/allItems"
                ) || [];


            const aFilterParts =
                this._getPartsForLocation(
                    aAllItems,
                    this._sLocationFilter
                );


            oModel.setProperty(
                "/filterParts",
                aFilterParts
            );


            /*
             * Keep Part Number empty after
             * dynamic items are rebuilt.
             */
            if (oPartSelect) {

                oPartSelect.setSelectedKey("");
            }
        },


        _applyRecentIssuesFilter: function () {

            const oModel =
                this.getView()
                    .getModel("recentIssues");


            const aAllItems =
                oModel.getProperty(
                    "/allItems"
                ) || [];


            const sLocation =
                String(
                    this._sLocationFilter || ""
                )
                    .trim()
                    .toLowerCase();


            const sPartNumber =
                String(
                    this._sPartNumberFilter || ""
                )
                    .trim()
                    .toLowerCase();


            let aFilteredItems =
                aAllItems.slice();


            if (sLocation) {

                aFilteredItems =
                    aFilteredItems.filter(
                        function (oItem) {

                            return String(
                                oItem.location || ""
                            )
                                .trim()
                                .toLowerCase() ===
                                sLocation;

                        }
                    );
            }


            if (sPartNumber) {

                aFilteredItems =
                    aFilteredItems.filter(
                        function (oItem) {

                            return String(
                                oItem.partNumber || ""
                            )
                                .trim()
                                .toLowerCase() ===
                                sPartNumber;

                        }
                    );
            }


            oModel.setProperty(
                "/items",
                aFilteredItems
            );
        },


        onFilterSearch: function () {

            const oLocationSelect =
                this.byId(
                    "issueLocationFilterSelect"
                );


            const oPartSelect =
                this.byId(
                    "issuePartFilterSelect"
                );


            this._sLocationFilter =
                oLocationSelect
                    ? oLocationSelect.getSelectedKey()
                    : "";


            this._sPartNumberFilter =
                oPartSelect
                    ? oPartSelect.getSelectedKey()
                    : "";


            this._applyRecentIssuesFilter();
        },


        onFilterClear: function () {

            const oLocationSelect =
                this.byId(
                    "issueLocationFilterSelect"
                );


            const oPartSelect =
                this.byId(
                    "issuePartFilterSelect"
                );


            this._sLocationFilter = "";
            this._sPartNumberFilter = "";


            if (oLocationSelect) {

                oLocationSelect.setSelectedKey("");
            }


            if (oPartSelect) {

                oPartSelect.setSelectedKey("");
            }


            const oModel =
                this.getView()
                    .getModel("recentIssues");


            const aAllItems =
                oModel.getProperty(
                    "/allItems"
                ) || [];


            oModel.setProperty(
                "/filterParts",
                this._getPartsForLocation(
                    aAllItems,
                    ""
                )
            );


            /*
             * Explicitly restore empty selection
             * after dynamic items are rebuilt.
             */
            if (oLocationSelect) {

                oLocationSelect.setSelectedKey("");
            }


            if (oPartSelect) {

                oPartSelect.setSelectedKey("");
            }


            this._applyRecentIssuesFilter();
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


        onRefreshRecentIssues: function () {

            this._loadRecentIssues();
        },


        onLocationChange: async function (oEvent) {

            const sLocationID =
                oEvent.getSource()
                    .getSelectedKey();


            const oIssuePartsModel =
                this.getView()
                    .getModel("issueParts");


            if (!sLocationID) {

                oIssuePartsModel.setProperty(
                    "/items",
                    []
                );


                this.byId(
                    "issuePartSelect"
                ).setSelectedKey("");


                return;
            }


            await Promise.all([
                this._pSpareParts,
                this._pInventory
            ]);


            const aInventoryForLocation =
                this._aInventory.filter(
                    function (oInventory) {

                        return (
                            String(
                                oInventory.location_ID
                            ) ===
                            String(
                                sLocationID
                            )
                        );

                    }
                );


            const aPartIDs =
                aInventoryForLocation.map(
                    function (oInventory) {

                        return String(
                            oInventory.part_ID
                        );

                    }
                );


            const aFilteredParts =
                this._aSpareParts.filter(
                    function (oPart) {

                        return aPartIDs.includes(
                            String(oPart.ID)
                        );

                    }
                );


            console.log(
                "Selected Location:",
                sLocationID
            );


            console.log(
                "Inventory for Location:",
                aInventoryForLocation
            );


            console.log(
                "Part IDs:",
                aPartIDs
            );


            console.log(
                "Filtered Spare Parts:",
                aFilteredParts
            );


            oIssuePartsModel.setProperty(
                "/items",
                aFilteredParts
            );


            this.byId(
                "issuePartSelect"
            ).setSelectedKey("");
        },


        onIssueStock: async function () {

            const oModel =
                this.getView().getModel();


            const partID =
                this.byId(
                    "issuePartSelect"
                ).getSelectedKey();


            const locationID =
                this.byId(
                    "issueLocSelect"
                ).getSelectedKey();


            const quantity =
                Number(
                    this.byId(
                        "issueQtyInput"
                    ).getValue()
                );


            const reference =
                this.byId(
                    "issueRefInput"
                ).getValue().trim();


            if (!locationID) {

                MessageBox.error(
                    "Please select a From Warehouse."
                );

                return;
            }


            if (!partID) {

                MessageBox.error(
                    "Please select a Spare Part."
                );

                return;
            }


            if (!(quantity > 0)) {

                MessageBox.error(
                    "Please enter a valid quantity."
                );

                return;
            }


            try {

                const oAction =
                    oModel.bindContext(
                        "/issueStock(...)"
                    );


                oAction.setParameter(
                    "partID",
                    partID
                );


                oAction.setParameter(
                    "locationID",
                    locationID
                );


                oAction.setParameter(
                    "quantity",
                    quantity
                );


                oAction.setParameter(
                    "reference",
                    reference
                );


                await oAction.execute();


                MessageToast.show(
                    "Stock issued successfully."
                );


                this.byId(
                    "issueLocSelect"
                ).setSelectedKey("");


                this.byId(
                    "issuePartSelect"
                ).setSelectedKey("");


                this.byId(
                    "issueQtyInput"
                ).setValue("");


                this.byId(
                    "issueRefInput"
                ).setValue("");


                this.getView()
                    .getModel("issueParts")
                    .setProperty(
                        "/items",
                        []
                    );


                await this._loadInventory();
                await this._loadRecentIssues();

            } catch (oError) {

                console.error(
                    "Issue Stock error:",
                    oError
                );


                let sMessage =
                    "Failed to issue stock.";


                if (
                    oError &&
                    oError.message
                ) {

                    sMessage =
                        oError.message;
                }


                MessageBox.error(
                    sMessage
                );
            }
        },


        onNavBack: function () {

            this.getOwnerComponent()
                .getRouter()
                .navTo("dashboard");
        }

    });
});