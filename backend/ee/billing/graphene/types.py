from graphene import Enum


class PlanTypeEnum(Enum):
    PRO = "pro"
    ENTERPRISE = "enterprise"


class BillingPeriodEnum(Enum):
    MONTHLY = "monthly"
    YEARLY = "yearly"


class BillingIssueEnum(Enum):
    """The Stripe status of a paid subscription that is awaiting payment."""

    PAST_DUE = "past_due"
    UNPAID = "unpaid"
    INCOMPLETE = "incomplete"
    PAUSED = "paused"
