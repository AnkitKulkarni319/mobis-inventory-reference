using mobis.db as db from '../db/schema';

@requires: 'authenticated-user'
service ProcurementService @(path: '/procurement') {

  @restrict: [
    { grant: ['READ','CREATE','UPDATE'], to: 'ProcurementOfficer' },
    { grant: 'READ', to: 'ProcurementApprover' }
  ]
  entity PurchaseRequisitions as projection on db.PurchaseRequisitions;

  @restrict: [
    { grant: ['READ','CREATE','UPDATE','DELETE'], to: 'ProcurementOfficer' },
    { grant: 'READ', to: 'ProcurementApprover' }
  ]
  entity PurchaseRequisitionItems as projection on db.PurchaseRequisitionItems;

  @restrict: [
    { grant: 'READ', to: ['ProcurementOfficer','ProcurementApprover','WarehouseExecutive'] }
  ]
  @readonly 
  entity PurchaseOrders     as projection on db.PurchaseOrders;

  @restrict: [
    { grant: 'READ', to: ['ProcurementOfficer','ProcurementApprover','WarehouseExecutive'] }
  ]
  @readonly 
  entity PurchaseOrderItems as projection on db.PurchaseOrderItems;

  @restrict: [
    { grant: ['READ','CREATE'], to: 'WarehouseExecutive' },
    { grant: 'READ', to: 'ProcurementOfficer' }
  ]
  entity GoodsReceipts     as projection on db.GoodsReceipts;

  @restrict: [
    { grant: ['READ','CREATE'], to: 'WarehouseExecutive' },
    { grant: 'READ', to: 'ProcurementOfficer' }
  ]
  entity GoodsReceiptItems as projection on db.GoodsReceiptItems;

  @restrict: [
    { grant: 'READ', to: ['ProcurementOfficer','ProcurementApprover','WarehouseExecutive'] }
  ]
  @readonly 
  entity Suppliers as projection on db.Suppliers;

  @restrict: [
    { grant: ['READ','UPDATE'], to: ['ProcurementOfficer','WarehouseExecutive'] }
  ]
  entity AlertNotifications as projection on db.AlertNotifications;

  @restrict: [{ grant: 'submitPR', to: 'ProcurementOfficer' }]
  action submitPR(prID: UUID) returns PurchaseRequisitions;

  @restrict: [{ grant: 'approvePR', to: 'ProcurementApprover' }]
  action approvePR(prID: UUID, approver: String) returns PurchaseRequisitions;

  @restrict: [{ grant: 'rejectPR', to: 'ProcurementApprover' }]
  action rejectPR(prID: UUID, approver: String, reason: String) returns PurchaseRequisitions;

  @restrict: [{ grant: 'createPOFromPR', to: 'ProcurementOfficer' }]
  action createPOFromPR(prID: UUID) returns array of PurchaseOrders;

  @restrict: [{ grant: 'postGoodsReceipt', to: 'WarehouseExecutive' }]
  action postGoodsReceipt(poID: UUID,locationID : UUID,receivedBy : String,items: array of { poItemID: UUID; receivedQty: Integer})returns GoodsReceipts;

  @restrict: [{ grant: 'resolveAlert', to: ['ProcurementOfficer','WarehouseExecutive'] }]
  action resolveAlert(alertID: UUID) returns AlertNotifications;
}