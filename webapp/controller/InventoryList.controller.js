sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel"
], function (Controller, JSONModel) {
    "use strict";

    return Controller.extend("inventorytest.controller.InventoryList", {

        onInit: function () {

            this._sCurrentFilter = "all";
            this._sLocationFilter = "";
            this._sPartNumberFilter = "";

            this.getView().setModel(
                new JSONModel({
                    allItems: [],
                    items: [],
                    locations: [],
                    filterParts: []
                }),
                "inventoryList"
            );

            this.getOwnerComponent()
                .getRouter()
                .getRoute("inventory")
                .attachPatternMatched(
                    this._onRouteMatched,
                    this
                );

            this._loadInventory();
        },


        _loadInventory: async function () {

            try {

                const oModel =
                    this.getOwnerComponent().getModel();

                const oInvBinding = oModel.bindList(
                    "/Inventory",
                    null,
                    [],
                    [],
                    {
                        $expand: "part,location"
                    }
                );

                const aContexts =
                    await oInvBinding.requestContexts(
                        0,
                        10000
                    );

                const aInventory =
                    aContexts.map(function (oContext) {

                        const oRow =
                            oContext.getObject();

                        const iReorderLevel =
                            oRow.reorderLevel !== null &&
                            oRow.reorderLevel !== undefined
                                ? oRow.reorderLevel
                                : (
                                    oRow.part &&
                                    oRow.part.reorderLevel !== null &&
                                    oRow.part.reorderLevel !== undefined
                                        ? oRow.part.reorderLevel
                                        : 0
                                );

                        let sStatus;
                        let sStatusState;

                        if (oRow.quantityOnHand <= 0) {

                            sStatus = "Out of Stock";
                            sStatusState = "Error";

                        } else if (
                            oRow.quantityOnHand <=
                            iReorderLevel
                        ) {

                            sStatus = "Low Stock";
                            sStatusState = "Warning";

                        } else {

                            sStatus = "Healthy";
                            sStatusState = "Success";
                        }

                        return {

                            ID: oRow.ID,

                            locationID:
                                oRow.location_ID,

                            locationName:
                                oRow.location
                                    ? oRow.location.name
                                    : oRow.location_ID,

                            partID:
                                oRow.part_ID,

                            partNumber:
                                oRow.part
                                    ? oRow.part.partNumber
                                    : oRow.part_ID,

                            description:
                                oRow.part
                                    ? oRow.part.description
                                    : "",

                            quantityOnHand:
                                oRow.quantityOnHand,

                            reorderLevel:
                                iReorderLevel,

                            status:
                                sStatus,

                            statusState:
                                sStatusState
                        };
                    });


                const oInventoryListModel =
                    this.getView()
                        .getModel("inventoryList");


                oInventoryListModel.setData({

                    allItems:
                        aInventory,

                    items:
                        aInventory.slice(),

                    locations: [],

                    filterParts: []

                });


                this._applyRouteFilter();

            } catch (oError) {

                console.error(
                    "Failed to load inventory:",
                    oError
                );
            }
        },


        /* ============================================================
         * STATUS FILTER
         * ============================================================ */

        _getStatusFilteredItems: function (
            aInventory
        ) {

            const sFilter =
                this._sCurrentFilter || "all";

            switch (sFilter) {

                case "lowStock":

                    return aInventory.filter(
                        function (oItem) {

                            return oItem.status ===
                                "Low Stock";
                        }
                    );


                case "outOfStock":

                    return aInventory.filter(
                        function (oItem) {

                            return oItem.status ===
                                "Out of Stock";
                        }
                    );


                case "healthy":

                    return aInventory.filter(
                        function (oItem) {

                            return oItem.status ===
                                "Healthy";
                        }
                    );


                default:

                    return aInventory.slice();
            }
        },


        /* ============================================================
         * LOCATION DROPDOWN
         * ============================================================ */

        _updateLocationFilterItems: function (
            aItems
        ) {

            const oModel =
                this.getView()
                    .getModel("inventoryList");


            const aLocationNames = [
                ...new Set(
                    aItems
                        .map(function (oItem) {

                            return oItem.locationName;

                        })
                        .filter(Boolean)
                )
            ].sort();


            const aLocations =
                aLocationNames.map(
                    function (sLocation) {

                        return {
                            key: sLocation,
                            text: sLocation
                        };

                    }
                );


            oModel.setProperty(
                "/locations",
                aLocations
            );
        },


        /* ============================================================
         * PART NUMBER FILTER DATA
         * ============================================================ */

        _getPartsForLocation: function (
            aInventory,
            sLocation
        ) {

            const sSelectedLocation =
                String(
                    sLocation || ""
                )
                    .trim()
                    .toLowerCase();


            let aItems;


            if (!sSelectedLocation) {

                aItems =
                    aInventory;

            } else {

                aItems =
                    aInventory.filter(
                        function (oItem) {

                            return String(
                                oItem.locationName || ""
                            )
                                .trim()
                                .toLowerCase() ===
                                sSelectedLocation;

                        }
                    );
            }


            const oParts = {};


            aItems.forEach(
                function (oItem) {

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
                }
            );


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


        /* ============================================================
         * UPDATE FILTER DROPDOWNS
         * ============================================================ */

        _updateFilterDropdowns: function () {

            const oModel =
                this.getView()
                    .getModel("inventoryList");


            const aAllItems =
                oModel.getProperty(
                    "/allItems"
                ) || [];


            const aStatusItems =
                this._getStatusFilteredItems(
                    aAllItems
                );


            /* Update Location dropdown */
            this._updateLocationFilterItems(
                aStatusItems
            );


            /* Update Part Number dropdown */
            const aFilterParts =
                this._getPartsForLocation(
                    aStatusItems,
                    this._sLocationFilter
                );


            oModel.setProperty(
                "/filterParts",
                aFilterParts
            );


            /*
             * Keep the Select controls synchronized
             * with the actual filter state.
             *
             * This prevents UI5 from automatically
             * displaying the first dynamic item.
             */

            const oLocationSelect =
                this.byId(
                    "locationFilterSelect"
                );


            const oPartSelect =
                this.byId(
                    "partFilterSelect"
                );


            if (oLocationSelect) {

                oLocationSelect.setSelectedKey(
                    this._sLocationFilter || ""
                );
            }


            if (oPartSelect) {

                oPartSelect.setSelectedKey(
                    this._sPartNumberFilter || ""
                );
            }
        },


        /* ============================================================
         * LOCATION CHANGE
         * ============================================================ */

        onLocationFilterChange: function (
            oEvent
        ) {

            const sLocation =
                oEvent.getSource()
                    .getSelectedKey();


            this._sLocationFilter =
                sLocation;


            /*
             * Reset Part Number whenever
             * Location changes.
             */

            this._sPartNumberFilter =
                "";


            const oPartSelect =
                this.byId(
                    "partFilterSelect"
                );


            if (oPartSelect) {

                oPartSelect.setSelectedKey("");
            }


            const oModel =
                this.getView()
                    .getModel("inventoryList");


            const aAllItems =
                oModel.getProperty(
                    "/allItems"
                ) || [];


            const aStatusItems =
                this._getStatusFilteredItems(
                    aAllItems
                );


            const aFilterParts =
                this._getPartsForLocation(
                    aStatusItems,
                    sLocation
                );


            oModel.setProperty(
                "/filterParts",
                aFilterParts
            );


            /*
             * Make sure Part Number remains empty
             * after its items are rebuilt.
             */

            if (oPartSelect) {

                oPartSelect.setSelectedKey("");
            }
        },


        /* ============================================================
         * ROUTE MATCHED
         * ============================================================ */

        _onRouteMatched: function (
            oEvent
        ) {

            const oArguments =
                oEvent.getParameter(
                    "arguments"
                );


            this._sCurrentFilter =
                oArguments.filter || "all";


            /*
             * Always start with empty manual filters
             * when entering a dashboard status.
             */

            this._sLocationFilter =
                "";

            this._sPartNumberFilter =
                "";


            const oLocationSelect =
                this.byId(
                    "locationFilterSelect"
                );


            const oPartSelect =
                this.byId(
                    "partFilterSelect"
                );


            if (oLocationSelect) {

                oLocationSelect.setSelectedKey("");
            }


            if (oPartSelect) {

                oPartSelect.setSelectedKey("");
            }


            this._applyRouteFilter();
        },


        /* ============================================================
         * SEARCH / GO
         * ============================================================ */

        onFilterSearch: function () {

            const oLocationSelect =
                this.byId(
                    "locationFilterSelect"
                );


            const oPartSelect =
                this.byId(
                    "partFilterSelect"
                );


            this._sLocationFilter =
                oLocationSelect
                    ? oLocationSelect.getSelectedKey()
                    : "";


            this._sPartNumberFilter =
                oPartSelect
                    ? oPartSelect.getSelectedKey()
                    : "";


            this._applyRouteFilter();
        },


        /* ============================================================
         * CLEAR FILTERS
         * ============================================================ */

        onFilterClear: function () {

            this._sLocationFilter =
                "";

            this._sPartNumberFilter =
                "";


            const oLocationSelect =
                this.byId(
                    "locationFilterSelect"
                );


            const oPartSelect =
                this.byId(
                    "partFilterSelect"
                );


            if (oLocationSelect) {

                oLocationSelect.setSelectedKey("");
            }


            if (oPartSelect) {

                oPartSelect.setSelectedKey("");
            }


            this._updateFilterDropdowns();


            /*
             * Explicitly keep both controls empty
             * after dropdown refresh.
             */

            if (oLocationSelect) {

                oLocationSelect.setSelectedKey("");
            }


            if (oPartSelect) {

                oPartSelect.setSelectedKey("");
            }


            this._applyRouteFilter();
        },


        /* ============================================================
         * APPLY FILTERS
         * ============================================================ */

        _applyRouteFilter: function () {

            const oModel =
                this.getView()
                    .getModel("inventoryList");


            if (!oModel) {
                return;
            }


            const aAllItems =
                oModel.getProperty(
                    "/allItems"
                ) || [];


            const sFilter =
                this._sCurrentFilter || "all";


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


            /*
             * First apply dashboard status.
             */

            let aFilteredItems =
                this._getStatusFilteredItems(
                    aAllItems
                );


            /*
             * Refresh dropdown data.
             */

            this._updateFilterDropdowns();


            /*
             * Location filter.
             */

            if (sLocation) {

                aFilteredItems =
                    aFilteredItems.filter(
                        function (oItem) {

                            return String(
                                oItem.locationName || ""
                            )
                                .trim()
                                .toLowerCase() ===
                                sLocation;

                        }
                    );
            }


            /*
             * Part Number filter.
             */

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


            /*
             * Update table.
             */

            oModel.setProperty(
                "/items",
                aFilteredItems
            );


            /*
             * Page title.
             */

            const oPage =
                this.byId(
                    "inventoryListPage"
                );


            if (!oPage) {
                return;
            }


            switch (sFilter) {

                case "lowStock":

                    oPage.setTitle(
                        "Inventory List - Low Stock"
                    );

                    break;


                case "outOfStock":

                    oPage.setTitle(
                        "Inventory List - Out of Stock"
                    );

                    break;


                case "healthy":

                    oPage.setTitle(
                        "Inventory List - Healthy"
                    );

                    break;


                default:

                    oPage.setTitle(
                        "Inventory List"
                    );

                    break;
            }
        },


        /* ============================================================
         * NAVIGATION BACK
         * ============================================================ */

        onNavBack: function () {

            this.getOwnerComponent()
                .getRouter()
                .navTo("dashboard");

        }

    });
});