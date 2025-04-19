from graphene import Enum


class PlanTypeEnum(Enum):
    PRO = "pro"
    ENTERPRISE = "enterprise"


class BillingPeriodEnum(Enum):
    MONTHLY = "monthly"
    YEARLY = "yearly"
