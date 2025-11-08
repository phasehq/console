from graphene_django.views import GraphQLView
from django.contrib.auth.mixins import LoginRequiredMixin
from graphql import specified_rules
from backend.graphene.validation import DuplicateFieldLimitRule, AliasUsageLimitRule
import logging


logger = logging.getLogger(__name__)

CUSTOM_RULES = tuple(specified_rules) + (
    DuplicateFieldLimitRule,
    AliasUsageLimitRule,
)


class PrivateGraphQLView(LoginRequiredMixin, GraphQLView):
    raise_exception = True
    validation_rules = CUSTOM_RULES
