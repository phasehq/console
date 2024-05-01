from graphene_django.views import GraphQLView
from django.contrib.auth.mixins import LoginRequiredMixin


class PrivateGraphQLView(LoginRequiredMixin, GraphQLView):
    raise_exception = True
    pass
