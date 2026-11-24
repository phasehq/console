from graphene import Enum


class PlanTypeEnum(Enum):
    PRO = "pro"
    ENTERPRISE = "enterprise"


class BillingPeriodEnum(Enum):
    MONTHLY = "monthly"
    YEARLY = "yearly"


class BillingIssueEnum(Enum):
    """Why an org with a paid subscription is awaiting payment: the subscription's
    Stripe status, or an overdue invoice while the subscription is active."""

    PAST_DUE = "past_due"
    UNPAID = "unpaid"
    INCOMPLETE = "incomplete"
    PAUSED = "paused"
    UNPAID_INVOICE = "unpaid_invoice"
