using Awake.Application.Common.Models;
using MediatR;

namespace Awake.Application.Features.Maps.Queries.GetMapModel;

public record GetMapModelQuery(string Location) : IRequest<Result<string>>;
