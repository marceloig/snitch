from .views import AwsAccountView  
from django.urls import path  
  
urlpatterns = [  
    path('aws-account/', AwsAccountView.as_view())  
]  